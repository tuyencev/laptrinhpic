import * as data from './jig_data.js';
import * as ui from './jig_render.js';
import * as sim from './jig_sim.js';

const DEFAULT_595 = ['CYL1_EXT','CYL1_RET','CYL2_EXT','CYL2_RET','CYL3_EXT','CYL3_RET','MOT1_EN','MOT1_DIR'];
const DEFAULT_LEDS = ['LED_PASS','LED_FAIL','LED_RUN','ALARM','','','',''];

function wireGlobals() {
  window.addDI = ui.addDI;
  window.renderDI = ui.renderDI;
  window.addDO = ui.addDO;
  window.renderDO = ui.renderDO;
  window.addCyl = ui.addCyl;
  window.renderCyl = ui.renderCyl;
  window.addMot = ui.addMot;
  window.renderMot = ui.renderMot;
  window.addVar = ui.addVar;
  window.renderVar = ui.renderVar;
  window.addTask = ui.addTask;
  window.renderTask = ui.renderTask;
  window.refresh = ui.refresh;
  window.lt = ui.lt;
  window.rt = ui.rt;
  window.copyCode = ui.copyCode;
  window.downloadC = ui.downloadC;
  window.runSim = sim.runSim;
  window.stopSim = sim.stopSim;
  window.resetTask = sim.resetTask;
  window.simBtn = sim.simBtn;
  window.toggleSimInput = sim.toggleSimInput;
  window.clearLog = sim.clearLog;
}

function addDefaults() {
  ui.addDI('SEN_HOME', 'RB0', 'HIGH', '10');
  ui.addDI('SEN_PART', 'RB1', 'HIGH', '10');
  ui.addDI('SEN_CYL1_EXT', 'RB2', 'HIGH', '10');
  ui.addDI('SEN_CYL1_RET', 'RB3', 'HIGH', '10');
  ui.addDI('SEN_MOT_FWD', 'RB4', 'HIGH', '10');
  

  ui.addCyl('cyl1', 'SR:CYL1_EXT', 'SR:CYL1_RET', 'SEN_CYL1_EXT', 'SEN_CYL1_RET', '4000');
  ui.addMot('motor1', 'SR:MOT1_EN', 'SR:MOT1_DIR', 'SEN_MOT_FWD', '', '5000');
  ui.addVar('dem_loi', 'uint8_t', '0');
  ui.addVar('buoc', 'uint8_t', '0');

  ui.addTask('task_kep', '1');
  ui.addTask('task_gia_cong', '2');
  ui.addTask('task_bao_hieu', '3');
}

function addExampleFlow() {
  const ex = `<xml>
    <block type="b_task_begin" x="20" y="20">
      <field name="TK">task_kep</field>
      <statement name="S">
        <block type="b_wait_di_on"><field name="DI">SEN_PART</field>
        <next><block type="b_cyl_ext"><field name="C">cyl1</field>
        <next><block type="b_cyl_wait_ext"><field name="C">cyl1</field>
        <next><block type="b_delay"><field name="MS">200</field>
        <next><block type="b_emit"><field name="EV">EVT_KEP_XONG</field>
        <next><block type="b_wait_all"><field name="EVS">EVT_GIA_CONG_XONG</field>
        <next><block type="b_cyl_ret"><field name="C">cyl1</field>
        <next><block type="b_pass"></block></next></block></next></block></next></block></next></block></next></block></next></block></next></block>
      </statement>
    </block>
    <block type="b_task_begin" x="420" y="20">
      <field name="TK">task_gia_cong</field>
      <statement name="S">
        <block type="b_wait_all"><field name="EVS">EVT_KEP_XONG</field>
        <next><block type="b_mot_run_sen"><field name="M">motor1</field><field name="D">FWD</field>
        <next><block type="b_delay"><field name="MS">500</field>
        <next><block type="b_mot_run_sen"><field name="M">motor1</field><field name="D">REV</field>
        <next><block type="b_emit"><field name="EV">EVT_GIA_CONG_XONG</field>
        <next><block type="b_task_done"></block></next></block></next></block></next></block></next></block></next></block>
      </statement>
    </block>
    <block type="b_task_begin" x="820" y="20">
      <field name="TK">task_bao_hieu</field>
      <statement name="S">
        <block type="b_wait_any"><field name="EVS">EVT_KEP_XONG,EVT_GIA_CONG_XONG</field>
        <next><block type="b_sr_set"><field name="B">LED_RUN</field>
        <next><block type="b_if_multi">
          <field name="D1">SEN_PART</field><field name="V1">1</field><field name="OP1">AND</field>
          <field name="D2">SEN_HOME</field><field name="V2">0</field><field name="OP2">END</field>
          <field name="D3">SEN_HOME</field><field name="V3">0</field>
          <statement name="DO"><block type="b_sr_set"><field name="B">ALARM</field></block></statement>
          <statement name="ELSE"><block type="b_sr_clr"><field name="B">ALARM</field></block></statement>
        </block></next></block></next></block>
      </statement>
    </block>
  </xml>`;
  const xmlDom = Blockly.Xml.textToDom ? Blockly.Xml.textToDom(ex) : Blockly.utils.xml.textToDom(ex);
  Blockly.Xml.domToWorkspace(xmlDom, data.workspace);
}

function initWorkspace() {
  const ws = Blockly.inject('bly', {
    toolbox: document.getElementById('toolbox'),
    grid: { spacing: 20, length: 3, colour: '#111828', snap: true },
    zoom: { controls: true, wheel: true, startScale: .88, maxScale: 2.5, minScale: .3 },
    trashcan: true,
    theme: Blockly.Theme.defineTheme('jigindustrial', {
      base: Blockly.Themes.Classic,
      componentStyles: {
        workspaceBackgroundColour: '#080c14',
        toolboxBackgroundColour: '#0b0f1a',
        toolboxForegroundColour: '#ccd6f0',
        flyoutBackgroundColour: '#06080e',
        flyoutForegroundColour: '#ccd6f0',
        flyoutOpacity: .99,
        scrollbarColour: '#1c2840',
        insertionMarkerColour: '#00c8d4',
        insertionMarkerOpacity: .9,
      },
    }),
    renderer: 'zelos',
  });
  data.setWorkspace(ws);
  ws.addChangeListener(ui.autoGen);
  return ws;
}

window.onload = function () {
  wireGlobals();
  ui.init595UI();

  DEFAULT_595.forEach((name, i) => { data.bits595[i].name = name; });
  DEFAULT_LEDS.forEach((name, i) => { data.bits595[8 + i].name = name || `Q${8 + i}`; });
  ui.init595UI();

  addDefaults();
  const workspace = initWorkspace();
  if (typeof window !== 'undefined') {
    window.workspace = workspace;
  }
  ui.refresh();
  addExampleFlow();
};
