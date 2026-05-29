import { diList, doList, cylList, motList, varList, taskList, bits595, workspace, noDI, noDO, noCYL, noMOT, noSR, noVAR, noTASK, noEVT } from './jig_data.js';
import { buildC, hl } from './jig_codegenv2.js';

const CL = {flow:'#f0a500',di:'#00c8d4',do:'#00c878',sr:'#9b6ef0',cyl:'#40c8e0',mot:'#30d090',vr:'#f0c040',ctrl:'#e83a3a'};
function def(n, fn){Blockly.Blocks[n] = { init: fn };}

Blockly.Extensions.registerMutator('b_if_multi_mutator', {
  mutationToDom() {
    const container = document.createElement('mutation');
    container.setAttribute('count', this.conditionCount_);
    return container;
  },
  domToMutation(xmlElement) {
    this.conditionCount_ = parseInt(xmlElement.getAttribute('count'), 10) || 2;
    this.updateShape_();
  },
  decompose(workspace) {
    const containerBlock = workspace.newBlock('b_if_multi_container');
    containerBlock.initSvg();
    let connection = containerBlock.getInput('STACK').connection;
    for (let i = 0; i < this.conditionCount_; i += 1) {
      const itemBlock = workspace.newBlock('b_if_multi_item');
      itemBlock.initSvg();
      connection.connect(itemBlock.previousConnection);
      connection = itemBlock.nextConnection;
    }
    return containerBlock;
  },
  compose(containerBlock) {
    let itemBlock = containerBlock.getInputTargetBlock('STACK');
    let count = 0;
    while (itemBlock) {
      count += 1;
      itemBlock = itemBlock.nextConnection && itemBlock.nextConnection.targetBlock();
    }
    this.conditionCount_ = Math.max(1, count);
    this.updateShape_();
  }
}, null, ['b_if_multi_item']);

function noDIorVAR() {
  const di = noDI().filter((o) => o[1] !== 'NONE').map(([n, v]) => [`[DI] ${n}`, `DI:${v}`]);
  const vr = noVAR().filter((o) => o[1] !== 'NONE').map(([n, v]) => [`[VAR] ${n}`, `VAR:${v}`]);
  return di.concat(vr).length ? di.concat(vr) : [['—', 'NONE']];
}

def('b_task_begin',function(){
  this.appendDummyInput().appendField('⚡ TASK').appendField(new Blockly.FieldDropdown(noTASK),'TK');
  this.appendStatementInput('S').setCheck(null).appendField('bước:');
  this.setColour(CL.flow);this.setTooltip('Entry point của 1 task độc lập');
});
def('b_emit',function(){
  this.appendDummyInput().appendField('📡 Trạng thái').appendField(new Blockly.FieldTextInput('EVT_DONE'),'EV');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.flow);
  this.setTooltip('Phát tín hiệu cho các task khác đang WAIT');
});
def('b_wait_all',function(){
  this.appendDummyInput().appendField('⏳ Chờ tất cả').appendField(new Blockly.FieldTextInput('EVT_A,EVT_B'),'EVS');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.flow);
  this.setTooltip('Chờ TẤT CẢ các event (AND). VD: EVT_A,EVT_B');
});
def('b_wait_any',function(){
  this.appendDummyInput().appendField('⏳ Chờ bất kỳ').appendField(new Blockly.FieldTextInput('EVT_A,EVT_B'),'EVS');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.flow);
  this.setTooltip('Chờ MỘT TRONG CÁC event (OR). VD: EVT_A,EVT_B');
});
def('b_task_done',function(){
  this.appendDummyInput().appendField('✅ TASK KẾT THÚC');
  this.setPreviousStatement(true);this.setColour(CL.flow);
});
def('b_wait_task_done', function() {
  this.appendDummyInput().appendField('⏳ Chờ TASK').appendField(new Blockly.FieldDropdown(noTASK), 'TK').appendField('KẾT THÚC');
  this.setPreviousStatement(true);
  this.setNextStatement(true);
  this.setColour(CL.flow);
  this.setTooltip('Chờ task khác kết thúc trước khi tiếp tục.');
});
// 1. ĐỊNH NGHĨA KHỐI ROOT CỦA SCHEDULER
Blockly.Blocks['b_scheduler_root'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("⚙️ LẬP TRÌNH SCHEDULER (QUÉT LIÊN TỤC)");
    // Tạo cổng kết nối "DO" để cho phép kéo các khối if, call_task vào bên trong
    this.appendStatementInput("DO")
        .setCheck(null);
    this.setColour(290); // Màu tím đặc trưng cho phân hệ điều khiển/Scheduler
    this.setTooltip("Khung cấu hình cho hàm Scheduler_Run. Các điều kiện bên trong sẽ được quét liên tục.");
    this.setHelpUrl("");
    // Khối này là khối gốc độc lập, không cho ghép phía trên hay phía dưới với khối khác
    this.setPreviousStatement(false);
    this.setNextStatement(false);
  }
};

// 2. ĐỊNH NGHĨA KHỐI GỌI TASK
Blockly.Blocks['b_call_task'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("▶️ Gọi Task:")
        .appendField(new Blockly.FieldDropdown(this.getTaskOptions), "TASK_NAME");
    // Cho phép ghép nối tuần tự (trên và dưới) bên trong cổng DO của scheduler hoặc if
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(230); // Màu xanh dương
    this.setTooltip("Kích hoạt thực thi một Task đã được tạo từ block b_task_begin");
    this.setHelpUrl("");
  },
  
  // Tự động quét toàn bộ màn hình để tìm các block 'b_task_begin' rồi nạp tên vào menu Dropdown
  getTaskOptions: function() {
    var options = [];
    var blocks = [];
    
    // Tùy thuộc vào phiên bản Blockly bạn đang dùng, lấy tất cả các block trên màn hình:
    if (typeof Blockly.Workspace !== 'undefined' && Blockly.Workspace.getAllStandardWorkspaceBlocks) {
      blocks = Blockly.Workspace.getAllStandardWorkspaceBlocks();
    } else if (Blockly.getMainWorkspace) {
      blocks = Blockly.getMainWorkspace().getAllBlocks();
    }
    
    // Lọc ra các block b_task_begin
    var taskBlocks = blocks.filter(function(b) {
      return b.type === 'b_task_begin';
    });
    
    taskBlocks.forEach(function(b) {
      var taskName = b.getFieldValue('TK'); // 'TK' là tên field chứa tên Task của bạn
      if (taskName) {
        options.push([taskName, taskName]);
      }
    });
    
    // Nếu chưa tạo block task nào, hiển thị NONE để giao diện không bị lỗi trống dropdown
    if (options.length === 0) {
      options.push(['(Chưa có Task nào)', 'NONE']);
    }
    return options;
  }
};


Blockly.Blocks['b_task_restart'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("Reset Task:")
        .appendField(new Blockly.FieldDropdown(this.generateTaskOptions), "TASK_NAME");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(230);
    this.setTooltip("Reset một task bất kỳ về trạng thái ban đầu");
  },
  
  // Hàm tự động quét toàn bộ workspace để lấy danh sách các Task đang có làm dữ liệu cho Dropdown
  generateTaskOptions: function() {
    const options = [];
    const ws = window.workspace || Blockly.getMainWorkspace();
    if (ws) {
      const blocks = ws.getAllBlocks(false);
      blocks.forEach(b => {
        if (b.type === 'b_task_begin') {
          const name = b.getFieldValue('TK');
          if (name) options.push([name, name]);
        }
      });
    }
    if (options.length === 0) {
      options.push(["Chính nó", ""]);
    }
    return options;
  }
};
def('b_delay',function(){
  this.appendDummyInput().appendField('⏱').appendField(new Blockly.FieldNumber(500,0.001,60000),'MS').appendField('ms');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.flow);
  this.setTooltip('Delay non-blocking. Task khác vẫn chạy!');
});
Blockly.Blocks['b_delay_var_dropdown'] = {
  init: function() {
    this.appendDummyInput()
        .appendField("Delay bằng biến")
        // Tạo một ô sổ xuống tự động liệt kê tất cả các biến trong hệ thống
        // 'delay_time' là tên biến mặc định hiển thị ban đầu
        .appendField(new Blockly.FieldDropdown(noVAR),'V')
        .appendField("(ms)");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(120);
    this.setTooltip("Trì hoãn thời gian dựa trên biến được chọn từ menu sổ xuống");
    this.setHelpUrl("");
  }
};

Blockly.Blocks['b_step'] = {
    init() {
      this.setColour(30);
      this.setTooltip(
        'Bước linh động: kéo b_if_multi / b_if_var / b_do_set... vào bên trong.\n' +
        'Dùng b_next_step để tiến, b_goto_step để nhảy về bước bất kỳ.'
      );
      this.appendDummyInput()
          .appendField('📦 BƯỚC ')
          .appendField(new Blockly.FieldTextInput(''), 'LABEL');
      this.appendStatementInput('BODY')
          .setCheck(null)
          .appendField('  nội dung:');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
    },
  };

  // ── b_next_step : tiến sang bước kế tiếp ────────────────────────────
  Blockly.Blocks['b_next_step'] = {
    init() {
      this.setColour(120);
      this.setTooltip('Tiến sang bước kế tiếp. Chỉ dùng bên trong b_step.');
      this.appendDummyInput()
          .appendField('▶▶ TIẾN BƯỚC');
      this.setPreviousStatement(true, null);
      this.setNextStatement(false, null);   // phải là lệnh cuối trong nhánh
    },
  };

  // ── b_goto_step : nhảy tới bước bất kỳ ─────────────────────────────
  Blockly.Blocks['b_goto_step'] = {
    init() {
      this.setColour(330);
      this.setTooltip(
        'Nhảy tới bước chỉ định.\n' +
        '• Nhập SỐ (0, 2, 5...) → nhảy đến S[số] đó.\n' +
        '• Nhập TÊN LABEL (ví dụ: "init") → nhảy đến b_step có label đó.'
      );
      this.appendDummyInput()
          .appendField('◀◀ NHẢY VỀ BƯỚC ')
          .appendField(new Blockly.FieldTextInput('0'), 'TARGET');
      this.setPreviousStatement(true, null);
      this.setNextStatement(false, null);   // phải là lệnh cuối trong nhánh
    },
  };

def('b_loop_n',function(){
  this.appendDummyInput().appendField('🔁').appendField(new Blockly.FieldNumber(3,1,9999),'N').appendField('lần:');
  this.appendStatementInput('DO');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.flow);
});
def('b_loop_while',function(){
  this.appendDummyInput().appendField('🔁 while').appendField(new Blockly.FieldDropdown(noDI),'DI').appendField('=').appendField(new Blockly.FieldDropdown([['ON','1'],['OFF','0']]),'V');
  this.appendStatementInput('DO');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.flow);
});

def('b_cond',function(){
  this.appendDummyInput()
    .appendField(new Blockly.FieldDropdown(noDI),'D1')
    .appendField(new Blockly.FieldDropdown([['ON','1'],['OFF','0']]),'V1')
    .appendField(new Blockly.FieldDropdown([['—','END'],['AND','AND'],['OR','OR']]),'OP1')
    .appendField(new Blockly.FieldDropdown(noDI),'D2')
    .appendField(new Blockly.FieldDropdown([['ON','1'],['OFF','0']]),'V2')
    .appendField(new Blockly.FieldDropdown([['—','END'],['AND','AND'],['OR','OR']]),'OP2')
    .appendField(new Blockly.FieldDropdown(noDI),'D3')
    .appendField(new Blockly.FieldDropdown([['ON','1'],['OFF','0']]),'V3');
  this.setOutput(true,'Boolean');this.setColour(CL.di);
  this.setTooltip('Điều kiện tối đa 3 DI kết hợp AND/OR. Chọn — để dừng');
});
def('b_if_multi_container', function() {
  this.appendDummyInput().appendField('Conditions');
  this.appendStatementInput('STACK');
  this.setColour(CL.di);
});
def('b_if_multi_item', function() {
  this.appendDummyInput().appendField('condition');
  this.setPreviousStatement(true);
  this.setNextStatement(true);
  this.setColour(CL.di);
});
def('b_if_multi',function(){
  this.conditionCount_ = 2;
  this.appendDummyInput('COND0')
    .appendField('❓ Nếu')
    .appendField(new Blockly.FieldDropdown(noDIorVAR),'F1')
    .appendField(new Blockly.FieldDropdown([['==','=='],['!=','!='],['>','>'],['<','<'],['>=','>='],['<=','<=']]),'CMP1')
    .appendField(new Blockly.FieldTextInput('1'),'V1');
  this.appendDummyInput('COND1')
    .appendField(new Blockly.FieldDropdown([['AND','AND'],['OR','OR']]),'LOGIC1')
    .appendField(new Blockly.FieldDropdown(noDIorVAR),'F2')
    .appendField(new Blockly.FieldDropdown([['==','=='],['!=','!='],['>','>'],['<','<'],['>=','>='],['<=','<=']]),'CMP2')
    .appendField(new Blockly.FieldTextInput('1'),'V2');
  this.appendStatementInput('DO').appendField('thì:');
 
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.di);
  this.setTooltip('If với nhiều điều kiện AND/OR. Mở mutator để thêm/bớt điều kiện.');
  Blockly.Extensions.apply('b_if_multi_mutator', this, true);
  this.updateShape_ = function() {
    const saved = [];
    for (let i = 0; i < this.conditionCount_; i += 1) {
      saved.push({
        F: this.getFieldValue(`F${i + 1}`),
        CMP: this.getFieldValue(`CMP${i + 1}`),
        V: this.getFieldValue(`V${i + 1}`),
        LOGIC: i > 0 ? this.getFieldValue(`LOGIC${i}`) : null,
      });
      if (this.getInput(`COND${i}`)) this.removeInput(`COND${i}`);
    }
    this.appendDummyInput('COND0')
      .appendField('❓ Nếu')
      .appendField(new Blockly.FieldDropdown(noDIorVAR), 'F1')
      .appendField(new Blockly.FieldDropdown([['==','=='],['!=','!='],['>','>'],['<','<'],['>=','>='],['<=','<=']]), 'CMP1')
      .appendField(new Blockly.FieldTextInput('1'), 'V1');
    if (saved[0]?.F) this.getField('F1').setValue(saved[0].F);
    if (saved[0]?.CMP) this.getField('CMP1').setValue(saved[0].CMP);
    if (saved[0]?.V) this.getField('V1').setValue(saved[0].V);
    for (let i = 1; i < this.conditionCount_; i += 1) {
      this.appendDummyInput(`COND${i}`)
        .appendField(new Blockly.FieldDropdown([['AND','AND'],['OR','OR']]), `LOGIC${i}`)
        .appendField(new Blockly.FieldDropdown(noDIorVAR), `F${i + 1}`)
        .appendField(new Blockly.FieldDropdown([['==','=='],['!=','!='],['>','>'],['<','<'],['>=','>='],['<=','<=']]), `CMP${i + 1}`)
        .appendField(new Blockly.FieldTextInput('1'), `V${i + 1}`);
      if (saved[i]?.LOGIC) this.getField(`LOGIC${i}`).setValue(saved[i].LOGIC);
      if (saved[i]?.F) this.getField(`F${i + 1}`).setValue(saved[i].F);
      if (saved[i]?.CMP) this.getField(`CMP${i + 1}`).setValue(saved[i].CMP);
      if (saved[i]?.V) this.getField(`V${i + 1}`).setValue(saved[i].V);
    }
  };
  this.mutationToDom = function() {
    const container = document.createElement('mutation');
    container.setAttribute('count', this.conditionCount_);
    return container;
  };
  this.domToMutation = function(xmlElement) {
    this.conditionCount_ = parseInt(xmlElement.getAttribute('count'), 10) || 2;
    this.updateShape_();
  };
  this.decompose = function(workspace) {
    const containerBlock = workspace.newBlock('b_if_multi_container');
    containerBlock.initSvg();
    let connection = containerBlock.getInput('STACK').connection;
    for (let i = 0; i < this.conditionCount_; i += 1) {
      const itemBlock = workspace.newBlock('b_if_multi_item');
      itemBlock.initSvg();
      connection.connect(itemBlock.previousConnection);
      connection = itemBlock.nextConnection;
    }
    return containerBlock;
  };
  this.compose = function(containerBlock) {
    let itemBlock = containerBlock.getInputTargetBlock('STACK');
    let count = 0;
    while (itemBlock) {
      count += 1;
      itemBlock = itemBlock.nextConnection && itemBlock.nextConnection.targetBlock();
    }
    this.conditionCount_ = Math.max(1, count);
    this.updateShape_();
  };
});
def('b_wait_di_on',function(){
  this.appendDummyInput().appendField('⏳ Chờ').appendField(new Blockly.FieldDropdown(noDI),'DI').appendField('ON');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.di);
});
def('b_wait_di_off',function(){
  this.appendDummyInput().appendField('⏳ Chờ').appendField(new Blockly.FieldDropdown(noDI),'DI').appendField('OFF');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.di);
});

def('b_do_set',function(){this.appendDummyInput().appendField('🟢 SET').appendField(new Blockly.FieldDropdown(noDO),'DO');this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.do);});
def('b_do_clr',function(){this.appendDummyInput().appendField('⚫ CLR').appendField(new Blockly.FieldDropdown(noDO),'DO');this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.do);});
def('b_do_tog',function(){this.appendDummyInput().appendField('🔃 TOG').appendField(new Blockly.FieldDropdown(noDO),'DO');this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.do);});
def('b_do_pulse',function(){
  this.appendDummyInput().appendField('🔔 PULSE').appendField(new Blockly.FieldDropdown(noDO),'DO').appendField(new Blockly.FieldNumber(200,10,9999),'MS').appendField('ms');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.do);
});

def('b_sr_set',function(){this.appendDummyInput().appendField('🟣Bật').appendField(new Blockly.FieldDropdown(noSR),'B');this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.sr);});
def('b_sr_clr',function(){this.appendDummyInput().appendField('⚪ Tắt').appendField(new Blockly.FieldDropdown(noSR),'B');this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.sr);});
def('b_sr_pulse',function(){
  this.appendDummyInput().appendField('⚡Bật - Tắt').appendField(new Blockly.FieldDropdown(noSR),'B').appendField(new Blockly.FieldNumber(200,10,9999),'MS').appendField('ms');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.sr);
});
def('b_sr_blink_forever', function() {
  this.appendDummyInput()
      .appendField('🔄 Bật-Tắt mãi')
      .appendField(new Blockly.FieldDropdown(noSR), 'B')
      .appendField('Bật')
      .appendField(new Blockly.FieldNumber(500, 10, 9999), 'MS_ON')
      .appendField('ms | Tắt')
      .appendField(new Blockly.FieldNumber(500, 10, 9999), 'MS_OFF')
      .appendField('ms');
  this.setPreviousStatement(true);
  // KHÔNG dùng this.setNextStatement(true) vì khối này chạy vô hạn, 
  // kéo thêm block bên dưới sẽ thành code chết không bao giờ chạy tới.
  this.setColour(CL.sr);
});
def('b_sr_byte',function(){
  this.appendDummyInput().appendField('📝 SR BYTE IC').appendField(new Blockly.FieldDropdown([['1','0'],['2','1'],['3','2']]),'IC').appendField('= 0x').appendField(new Blockly.FieldTextInput('FF'),'V');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.sr);
});

def('b_cyl_ext',function(){
  this.appendDummyInput().appendField('🔼 Bật').appendField(new Blockly.FieldDropdown(noCYL),'C');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.cyl);
  this.setTooltip('Ra lệnh xi lanh ra. Output/sensor lấy từ khai báo CYL tab.');
});
def('b_cyl_ret',function(){
  this.appendDummyInput().appendField('🔽 Tắt').appendField(new Blockly.FieldDropdown(noCYL),'C');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.cyl);
});
def('b_cyl_wait_ext',function(){
  this.appendDummyInput().appendField('✓ Chờ').appendField(new Blockly.FieldDropdown(noCYL),'C').appendField('ra hết');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.cyl);
  this.setTooltip('Chờ cảm biến EXT của xi lanh');
});
def('b_cyl_wait_ret',function(){
  this.appendDummyInput().appendField('✓ Chờ').appendField(new Blockly.FieldDropdown(noCYL),'C').appendField('vào hết');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.cyl);
});

// Khối điều khiển Motor Bước (Stepper Motor)
def('b_stepper_control', function() {
  this.appendDummyInput()
      .appendField('⚙️ MOTOR BƯỚC')
      .appendField(new Blockly.FieldDropdown(noMOT), 'MOT_NAME') // Sổ danh sách Motor khai báo từ jig_data.js
      .appendField('Chiều:')
      .appendField(new Blockly.FieldDropdown([["Thuận (CW)", "1"], ["Nghịch (CCW)", "0"]]), 'DIR')
      .appendField('Số bước:')
      .appendField(new Blockly.FieldNumber(200, 1, 10000), 'STEPS');

  this.appendDummyInput()
      .appendField('  ↳ Tốc độ (Delay):')
      .appendField(new Blockly.FieldNumber(2, 1, 100), 'SPEED_DELAY')
      .appendField('ms / bước');

  this.setPreviousStatement(true);
  this.setNextStatement(true);
  this.setColour(CL.mot || '#30d090'); // Giữ cùng tone màu xanh với Motor hệ thống của bạn
  this.setTooltip('Điều khiển motor bước quay theo số bước và chiều chỉ định.\nTốc độ tính bằng thời gian trễ (ms) giữa mỗi xung.');
});
def('b_mot_run_sen',function(){
  this.appendDummyInput()
    .appendField('▶').appendField(new Blockly.FieldDropdown(noMOT),'M')
    .appendField(new Blockly.FieldDropdown([['→ Thuận','FWD'],['← Nghịch','REV']]),'D')
    .appendField('đến sensor');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.mot);
  this.setTooltip('Chạy đến sensor FWD hoặc REV đã khai báo trong tab MOT');
});
def('b_mot_run_time',function(){
  this.appendDummyInput()
    .appendField('▶').appendField(new Blockly.FieldDropdown(noMOT),'M')
    .appendField(new Blockly.FieldDropdown([['→ Thuận','FWD'],['← Nghịch','REV']]),'D')
    .appendField(new Blockly.FieldNumber(2000,100,60000),'T').appendField('ms');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.mot);
});
def('b_mot_stop',function(){
  this.appendDummyInput().appendField('■ STOP').appendField(new Blockly.FieldDropdown(noMOT),'M');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.mot);
});
def('b_mot_wait',function(){
  this.appendDummyInput().appendField('✓ Chờ').appendField(new Blockly.FieldDropdown(noMOT),'M').appendField('xong');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.mot);
});

def('b_var_set',function(){
  this.appendDummyInput().appendField('𝑥').appendField(new Blockly.FieldDropdown(noVAR),'V').appendField('=').appendField(new Blockly.FieldTextInput('0'),'VAL');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.vr);
});
def('b_var_inc',function(){
  this.appendDummyInput().appendField('𝑥++').appendField(new Blockly.FieldDropdown(noVAR),'V');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.vr);
});
def('b_var_dec',function(){
  this.appendDummyInput().appendField('𝑥--').appendField(new Blockly.FieldDropdown(noVAR),'V');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.vr);
});
def('b_if_var',function(){
  this.appendDummyInput()
    .appendField('❓').appendField(new Blockly.FieldDropdown(noVAR),'V')
    .appendField(new Blockly.FieldDropdown([['==','=='],['!=','!='],['>=','>='],['<=','<='],['<','<'],['>','>']]),'OP')
    .appendField(new Blockly.FieldTextInput('0'),'VAL');
  this.appendStatementInput('DO').appendField('thì:');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.vr);
});

// Các block tiện ích
// Định nghĩa block b_timeout_sensor trong jig_render.js
def('b_timeout_sensor', function() {
  this.appendDummyInput()
      .appendField("Chờ cảm biến")
      .appendField(new Blockly.FieldDropdown(noDI),'DI')
  this.appendDummyInput()
      .appendField("mức")
      .appendField(new Blockly.FieldDropdown([["ON","1"],["OFF","0"]]), "V");
  this.appendDummyInput()
      .appendField("Quá thời gian (ms)")
      .appendField(new Blockly.FieldTextInput("4000"), "MS");
  this.appendDummyInput()
      .appendField("Báo Lỗi")
      .appendField(new Blockly.FieldTextInput("Lỗi cảm biến không phản hồi"), "MSG");
  this.setPreviousStatement(true, null);
  this.setNextStatement(true, null);
  this.setColour(CL.ctrl || '#e83a3a'); // Sử dụng màu đỏ cảnh báo/điều khiển
  this.setTooltip("Đợi cảm biến đạt trạng thái trong khoảng thời gian (ms), nếu quá thời gian sẽ kích hoạt trạng thái lỗi và bắn thông báo lên máy tính.");
});
def('b_var_control_by_btn', function() {
  this.appendDummyInput()
      .appendField('⚙️ ĐIỀU KHIỂN BIẾN:')
      .appendField(new Blockly.FieldDropdown(noVAR), 'V'); // Chọn biến cần thay đổi
      
  this.appendDummyInput()
      .appendField('  ➕ Nút Tăng:')
      .appendField(new Blockly.FieldDropdown(noDI), 'DI_INC') // Chọn nút bấm tăng
      .appendField('  ➖ Nút Giảm:')
      .appendField(new Blockly.FieldDropdown(noDI), 'DI_DEC'); // Chọn nút bấm giảm

  this.setPreviousStatement(true);
  this.setNextStatement(true);
  this.setColour(CL.var || 160); // Màu sắc nhóm biến của bạn
  this.setTooltip('Tự động tăng giảm biến số bằng 2 nút nhấn đầu vào và lưu vào EEPROM');
});
// Khối điều khiển LCD ĐƠN GIẢN & LINH ĐỘNG (Tích hợp Di chuyển + Hiển thị)
def('b_lcd_single', function() {
  this.appendDummyInput()
      .appendField('📺 LCD hiển thị')
      .appendField('Hàng:')
      .appendField(new Blockly.FieldDropdown([["1", "1"], ["2", "2"]]), 'ROW')
      .appendField('Cột:')
      .appendField(new Blockly.FieldNumber(1, 1, 20), 'COL');
      
  this.appendDummyInput('VAL_INPUT')
      .appendField('Kiểu:')
      .appendField(new Blockly.FieldDropdown([
          ["Chuỗi chữ (Text)", "STR"],
          ["Giá trị Biến (Variable)", "VAR"]
      ], function(newType) {
        // Hàm thay đổi giao diện động khi người dùng chọn giữa Text và Biến số
        this.getSourceBlock().updateInputShape_(newType);
      }), "TYPE")
      .appendField('Nội dung:')
      .appendField(new Blockly.FieldTextInput('JIG READY'), 'TEXT_VAL');

  this.setPreviousStatement(true);
  this.setNextStatement(true);
  this.setColour(190); // Giữ nguyên tone màu tím/hồng LCD của bạn
  this.setTooltip('Kéo 1 block duy nhất để điều hướng vị trí và hiển thị Text hoặc Biến số.\nTự động clear nội dung cũ nếu ghi đè cùng hàng.');

  // Hàm cập nhật ô nhập liệu dựa trên Dropdown loại dữ liệu
  this.updateInputShape_ = function(type) {
    const input = this.getInput('VAL_INPUT');
    // Xóa field nhập liệu cũ nếu có (bắt đầu từ vị trí field thứ 3 sau label 'Kiểu' và Dropdown TYPE)
    if (this.getField('TEXT_VAL')) input.removeField('TEXT_VAL');
    if (this.getField('VAR_VAL')) input.removeField('VAR_VAL');

    // Nạp field mới tương ứng
    if (type === 'STR') {
      input.appendField(new Blockly.FieldTextInput('JIG READY'), 'TEXT_VAL');
    } else if (type === 'VAR') {
      input.appendField(new Blockly.FieldDropdown(noVAR), 'VAR_VAL');
    }
  };
});
// Khối LCD nâng cao: Hỗ trợ ghép nối Chữ và nhiều Biến trên cùng một dòng
// Khối LCD nâng cao: Tự động sổ danh sách biến đã khai báo
def('b_lcd_advance', function() {
  this.appendDummyInput()
      .appendField('📺 LCD NÂNG CAO')
      .appendField('Hàng:')
      .appendField(new Blockly.FieldDropdown([["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"]]), 'ROW')
      .appendField('Cột:')
      .appendField(new Blockly.FieldNumber(1, 1, 20), 'COL');

  this.appendDummyInput()
      .appendField('Định dạng:')
      .appendField(new Blockly.FieldTextInput('t: %d ms  t3: %d ms', function(text) {
        // Tự động cập nhật số lượng dropdown chọn biến khi người dùng gõ/xóa %d
        this.getSourceBlock().updateVarInputs_(text);
      }), 'FORMAT');

  this.setPreviousStatement(true);
  this.setNextStatement(true);
  this.setColour(190);
  this.setTooltip('Sử dụng %d để đại diện cho biến số.\nVí dụ: "JIG: %d" sẽ tự động hiện 1 ô sổ xuống để chọn biến.');

  this.varCount_ = 0;

  // Hàm tự động tạo ô sổ xuống chọn biến
  this.updateVarInputs_ = function(text) {
    if (!text) return;
    const matches = text.match(/%d|%lu/g);
    const count = matches ? matches.length : 0;

    if (count !== this.varCount_) {
      Blockly.Events.disable();
      try {
        // Xóa các hàng chọn biến cũ
        for (let i = 0; i < this.varCount_; i++) {
          if (this.getInput('ROW_VAR' + i)) {
            this.removeInput('ROW_VAR' + i);
          }
        }
        
        // Tạo lại các ô sổ xuống (FieldDropdown) theo danh sách noVAR
        this.varCount_ = count;
        for (let i = 0; i < this.varCount_; i++) {
          this.appendDummyInput('ROW_VAR' + i)
              .appendField('  ↳ Chọn biến ' + (i + 1) + ':')
              .appendField(new Blockly.FieldDropdown(noVAR), 'VAR_SELECT' + i); // Hiện danh sách biến sổ xuống
        }
      } finally {
        Blockly.Events.enable();
      }
    }
  };

  this.mutationToDom = function() {
    const container = document.createElement('mutation');
    container.setAttribute('count', this.varCount_);
    return container;
  };

  this.domToMutation = function(xmlElement) {
    this.varCount = parseInt(xmlElement.getAttribute('count'), 10) || 0;
    for (let i = 0; i < this.varCount_; i++) {
      this.appendDummyInput('ROW_VAR' + i)
          .appendField('  ↳ Chọn biến ' + (i + 1) + ':')
          .appendField(new Blockly.FieldDropdown(noVAR), 'VAR_SELECT' + i);
    }
  };
});

// Block 1: Kiểm tra hành vi Click (Nhấn rồi THẢ RA)
def('b_button_click', function() {
  this.appendDummyInput()
      .appendField('🔘 NÚT nhấn thả')
      .appendField(new Blockly.FieldDropdown(noDI), 'BTN_PIN');
      
  this.appendStatementInput('DO_BRANCH')
      .setCheck(null)
      .appendField('Nếu nhấn rồi THẢ RA thì:');

  this.setPreviousStatement(true);
  this.setNextStatement(true);
  this.setColour(CL.ctrl || '#168a33');
  this.setTooltip('Kích hoạt các lệnh bên trong khi nút được nhấn xuống rồi buông tay ra (Click).');
});

// Block 2: Kiểm tra hành vi Long Press (NHẤN GIỮ)
def('b_button_hold', function() {
  this.appendDummyInput()
      .appendField('⏳ NÚT nhấn giữ')
      .appendField(new Blockly.FieldDropdown(noDI), 'BTN_PIN')
      .appendField('Thời gian giữ:')
      .appendField(new Blockly.FieldNumber(1000, 100, 5000), 'HOLD_TIME')
      .appendField('ms');
      
  this.appendStatementInput('DO_BRANCH')
      .setCheck(null)
      .appendField('⏳ Nếu giữ ĐỦ THỜI GIAN thì:');

  this.setPreviousStatement(true);
  this.setNextStatement(true);
  this.setColour(CL.ctrl || '#6d1b1b');
  this.setTooltip('Kích hoạt lệnh ngay khi đè giữ nút đủ thời gian cấu hình (không cần đợi nhả tay).');
});

def('b_err',function(){this.appendDummyInput().appendField('🛑 ERR STOP');this.setPreviousStatement(true);this.setColour(CL.ctrl);});
def('b_pass',function(){this.appendDummyInput().appendField('✅ PASS');this.setPreviousStatement(true);this.setNextStatement(true);this.setColour('#00c878');});
def('b_fail',function(){this.appendDummyInput().appendField('❌ FAIL');this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.ctrl);});
def('b_buzzer',function(){
  this.appendDummyInput().appendField('🔔').appendField(new Blockly.FieldNumber(1,1,10),'N').appendField('tiếng');
  this.setPreviousStatement(true);this.setNextStatement(true);this.setColour(CL.ctrl);
});

export function addDI(n = '', p = 'RB0', al = 'LOW', db = '20') {
  diList.push({ name: n, pin: p, active: al, debounce: db });
  renderDI();
  refresh();
}

export function renderDI() {
  document.getElementById('di-list').innerHTML = diList
    .map((d, i) => `
    <div class="card"><button class="xbtn" onclick="diList.splice(${i},1);renderDI();refresh()">✕</button>
      <div class="row"><span class="lbl">Name</span><input class="fi nm" value="${d.name}" placeholder="BTN_START" onchange="diList[${i}].name=this.value;refresh()"></div>
      <div class="row"><span class="lbl">PIN</span><input class="fi" value="${d.pin}" style="width:55px" onchange="diList[${i}].pin=this.value;refresh()">
        <select class="fs" onchange="diList[${i}].active=this.value"><option ${d.active === 'LOW' ? 'selected' : ''}>LOW</option><option ${d.active === 'HIGH' ? 'selected' : ''}>HIGH</option></select>
        <input class="fi" type="number" value="${d.debounce}" style="width:42px" placeholder="DB" onchange="diList[${i}].debounce=this.value"></div>
      <div class="row"><span></span><span class="badge bdi">DI #${i}</span></div>
    </div>`)
    .join('');
}

export function addDO(n = '', p = 'D8', ini = '0') {
  doList.push({ name: n, pin: p, init: ini });
  renderDO();
  refresh();
}

export function renderDO() {
  document.getElementById('do-list').innerHTML = doList
    .map((d, i) => `
    <div class="card"><button class="xbtn" onclick="doList.splice(${i},1);renderDO();refresh()">✕</button>
      <div class="row"><span class="lbl">Name</span><input class="fi nm" value="${d.name}" placeholder="RELAY_1" onchange="doList[${i}].name=this.value;refresh()"></div>
      <div class="row"><span class="lbl">PIN</span><input class="fi" value="${d.pin}" style="width:55px" onchange="doList[${i}].pin=this.value;refresh()">
        <select class="fs" onchange="doList[${i}].init=this.value"><option value="0" ${d.init === '0' ? 'selected' : ''}>Init=0</option><option value="1" ${d.init === '1' ? 'selected' : ''}>Init=1</option></select>
        <span class="badge bdo">DO</span>
      </div>
    </div>`)
    .join('');
}

export function addCyl(n = '', oe = '', or_ = '', de = '', dr = '', tmo = '4000') {
  cylList.push({ name: n, out_ext: oe, out_ret: or_, sen_ext: de, sen_ret: dr, timeout: tmo });
  renderCyl();
  refresh();
}

export function renderCyl() {
  document.getElementById('cyl-list').innerHTML = cylList
    .map((c, i) => `
    <div class="cyl-card"><button class="xbtn" onclick="cylList.splice(${i},1);renderCyl();refresh()">✕</button>
      <div class="row"><span class="lbl">Name</span><input class="fi nm" value="${c.name}" placeholder="cyl1" onchange="cylList[${i}].name=this.value;refresh()"></div>
      <div class="row"><span class="lbl">DO Ra</span>
        <select class="fs" onchange="cylList[${i}].out_ext=this.value">${doOptHtml(c.out_ext)}${srOptHtml(c.out_ext)}</select>
        <span style="font-size:8px;color:var(--mx);">EXT</span>
      </div>
      <div class="row"><span class="lbl">DO Vào</span>
        <select class="fs" onchange="cylList[${i}].out_ret=this.value">${doOptHtml(c.out_ret)}${srOptHtml(c.out_ret)}</select>
        <span style="font-size:8px;color:var(--mx);">RET</span>
      </div>
      <div class="row"><span class="lbl">Sen Ra</span>
        <select class="fs" onchange="cylList[${i}].sen_ext=this.value">${diOptHtml(c.sen_ext)}</select>
      </div>
      <div class="row"><span class="lbl">Sen Vào</span>
        <select class="fs" onchange="cylList[${i}].sen_ret=this.value">${diOptHtml(c.sen_ret)}</select>
      </div>
      <div class="row"><span class="lbl">Timeout</span><input class="fi" type="number" value="${c.timeout}" onchange="cylList[${i}].timeout=this.value"><span style="font-size:8px;color:var(--mx);">ms</span></div>
      <div class="row"><span></span><span class="badge bcyl">CYLINDER</span></div>
    </div>`)
    .join('');
}

export function addMot(n = '', oe = '', dir_pin = '', sen_fwd = '', sen_rev = '', tmo = '5000') {
  motList.push({ name: n, out_en: oe, out_dir: dir_pin, sen_fwd, sen_rev, timeout: tmo });
  renderMot();
  refresh();
}

export function renderMot() {
  document.getElementById('mot-list').innerHTML = motList
    .map((m, i) => `
    <div class="mot-card"><button class="xbtn" onclick="motList.splice(${i},1);renderMot();refresh()">✕</button>
      <div class="row"><span class="lbl">Name</span><input class="fi nm" value="${m.name}" placeholder="motor1" onchange="motList[${i}].name=this.value;refresh()"></div>
      <div class="row"><span class="lbl">DO EN</span>
        <select class="fs" onchange="motList[${i}].out_en=this.value">${doOptHtml(m.out_en)}${srOptHtml(m.out_en)}</select>
      </div>
      <div class="row"><span class="lbl">DO DIR</span>
        <select class="fs" onchange="motList[${i}].out_dir=this.value">${doOptHtml(m.out_dir)}${srOptHtml(m.out_dir)}</select>
      </div>
      <div class="row"><span class="lbl">Sen FWD</span>
        <select class="fs" onchange="motList[${i}].sen_fwd=this.value">${diOptHtml(m.sen_fwd)}</select>
      </div>
      <div class="row"><span class="lbl">Sen REV</span>
        <select class="fs" onchange="motList[${i}].sen_rev=this.value">${diOptHtml(m.sen_rev)}</select>
      </div>
      <div class="row"><span class="lbl">Timeout</span><input class="fi" type="number" value="${m.timeout}" onchange="motList[${i}].timeout=this.value"><span style="font-size:8px;color:var(--mx);">ms</span></div>
      <div class="row"><span></span><span class="badge bmot">MOTOR DC</span></div>
    </div>`)
    .join('');
}

function doOptHtml(cur) {
  const none = `<option value="NONE" ${!cur || cur === 'NONE' ? 'selected' : ''}>— GPIO—</option>`;
  return none + doList.filter((d) => d.name).map((d) => `<option value="DO:${d.name}" ${cur === `DO:${d.name}` ? 'selected' : ''}>${d.name}</option>`).join('');
}

function srOptHtml(cur) {
  return bits595.filter((b) => b.name && !b.name.startsWith('Q')).map((b) => `<option value="SR:${b.name}" ${cur === `SR:${b.name}` ? 'selected' : ''}>595:${b.name}</option>`).join('');
}

function diOptHtml(cur) {
  const none = `<option value="NONE" ${!cur || cur === 'NONE' ? 'selected' : ''}>— none —</option>`;
  return none + diList.filter((d) => d.name).map((d) => `<option value="${d.name}" ${cur === d.name ? 'selected' : ''}>${d.name}</option>`).join('');
}

export function init595UI() {
  const el = document.getElementById('sr-bit-list');
  el.innerHTML = [0, 1, 2].map((ic) => {
    const cells = [...Array(8)].map((_, b) => {
      const idx = ic * 8 + b;
      return `
        <div class="bc"><div class="bc-idx">IC${ic + 1}.Q${b}[${idx}]</div>
          <input class="bc-in" value="${bits595[idx].name}" placeholder="—" onchange="bits595[${idx}].name=this.value;refresh()"></div>`;
    }).join('');
    return `<div class="sr-cfg"><div class="sr-hd">IC ${ic + 1} — bits ${ic * 8}–${ic * 8 + 7}</div><div class="bits-g">${cells}</div></div>`;
  }).join('');
}

export function addVar(n = '', t = 'uint8_t', v = '0') {
  varList.push({ name: n, type: t, init: v });
  renderVar();
  refresh();
}

export function renderVar() {
  document.getElementById('var-list').innerHTML = varList
    .map((v, i) => `
    <div class="card"><button class="xbtn" onclick="varList.splice(${i},1);renderVar();refresh()">✕</button>
      <div class="row"><span class="lbl">Name</span><input class="fi nm" value="${v.name}" placeholder="dem" onchange="varList[${i}].name=this.value;refresh()"></div>
      <div class="row"><span class="lbl">Type</span>
        <select class="fs" onchange="varList[${i}].type=this.value">
          <option ${v.type === 'uint8_t' ? 'selected' : ''}>uint8_t</option>
          <option ${v.type === 'uint16_t' ? 'selected' : ''}>uint16_t</option>
        </select>
        <input class="fi" value="${v.init}" style="width:45px" onchange="varList[${i}].init=this.value">
        <span class="badge bvar">VAR</span>
      </div>
    </div>`)
    .join('');
}

export function addTask(n = '', pri = '1') {
  taskList.push({ name: n, priority: pri });
  renderTask();
  refresh();
}

export function renderTask() {
  document.getElementById('task-list').innerHTML = taskList
    .map((t, i) => `
    <div class="task-card"><button class="xbtn" onclick="taskList.splice(${i},1);renderTask();refresh()">✕</button>
      <div class="row"><span class="lbl">Name</span><input class="fi nm" value="${t.name}" placeholder="task_kep" onchange="taskList[${i}].name=this.value;refresh()"></div>
      <div class="row"><span class="lbl">Pri</span>
        <select class="fs" onchange="taskList[${i}].priority=this.value">
          <option value="1" ${t.priority === '1' ? 'selected' : ''}>1 — Cao nhất</option>
          <option value="2" ${t.priority === '2' ? 'selected' : ''}>2 — Trung bình</option>
          <option value="3" ${t.priority === '3' ? 'selected' : ''}>3 — Thấp</option>
        </select>
        <span class="badge btsk">TASK</span>
      </div>
    </div>`)
    .join('');
}

export function refresh() {
  renderCyl();
  renderMot();
  document.getElementById('task-monitor').innerHTML = taskList
    .filter((t) => t.name)
    .map((t) => `
    <div class="tm-row">
      <div class="tm-dot" id="tm-dot-${t.name}"></div>
      <span class="tm-name">${t.name}</span>
      <span class="tm-state" id="tm-st-${t.name}">IDLE</span>
      <button type="button" class="abtn" onclick="resetTask(${JSON.stringify(t.name)})" style="margin-left:8px;">RESET</button>
      <span style="font-size:8px;color:var(--dx);margin-left:auto;">P${t.priority}</span>
    </div>`)
    .join('');
  document.getElementById('sim-di-row').innerHTML = diList
    .filter((d) => d.name)
    .map((d) => `<div class="ioc" id="sdi-${d.name}" onclick="toggleSimInput('${d.name}')" title="Click to toggle input"><div class="ioc-d" style="background:var(--dx);"></div><span class="ioc-n">${d.name}</span></div>`)
    .join('');
  document.getElementById('sim-do-row').innerHTML = doList
    .filter((d) => d.name)
    .map((d) => `<div class="ioc" id="sdo-${d.name}"><div class="ioc-d" style="background:var(--dx);"></div><span class="ioc-n">${d.name}</span></div>`)
    .join('');
  document.getElementById('sim-sr-bits').innerHTML = [...Array(24)]
    .map((_, i) => `<div class="srb" id="srb-${i}" title="${bits595[i].name}">${(bits595[i].name || i + '').slice(0, 3)}</div>`)
    .join('');
  document.getElementById('s-tasks').textContent = `${taskList.length} tasks`;
  document.getElementById('s-io').textContent = `DI:${diList.length} DO:${doList.length} CYL:${cylList.length} MOT:${motList.length}`;
  autoGen();
}

export function autoGen() {
  try {
    const code = buildC();
    document.getElementById('code-out').innerHTML = hl(code);
    document.getElementById('s-blk').textContent = `${workspace ? workspace.getAllBlocks().length : 0} blocks`;
  } catch (error) {
    console.error(error);
  }
}

export function lt(i, el) {
  document.querySelectorAll('.lpt').forEach((tab) => tab.classList.remove('on'));
  document.querySelectorAll('.lpane').forEach((pane) => pane.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('lp' + i).classList.add('on');
}

export function rt(i, el) {
  document.querySelectorAll('.rpt').forEach((tab) => tab.classList.remove('on'));
  document.querySelectorAll('.rpane').forEach((pane) => pane.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('rp' + i).classList.add('on');
}

export function copyCode() {
  navigator.clipboard
    .writeText(document.getElementById('code-out').innerText)
    .then(() => {
      const t = document.getElementById('toast');
      t.textContent = '✓ Copied!';
      t.classList.add('on');
      setTimeout(() => t.classList.remove('on'), 1800);
    });
}
// Thêm đoạn này vào cuối file jig_render.js để bên HTML có thể gọi trực tiếp
if (typeof window !== 'undefined') {
  window.diList = diList;
  window.doList = doList;
  window.cylList = cylList;
  window.motList = motList;
  window.varList = varList;
  window.taskList = taskList;
  window.bits595 = bits595;
  window.workspace = workspace;
}
export function downloadC() {
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(document.getElementById('code-out').innerText);
  a.download = 'jig_v4.c';
  a.click();
}
