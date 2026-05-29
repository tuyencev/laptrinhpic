import { diList, doList, cylList, motList, varList, bits595, workspace } from './jig_data.js';

function buildMultiCond(block) {
  const count = block.conditionCount_ || 2;
  let expr = '';
  for (let i = 0; i < count; i += 1) {
    const src = block.getFieldValue(`F${i + 1}`) || 'DI:NONE';
    const cmp = block.getFieldValue(`CMP${i + 1}`) || '==';
    const val = block.getFieldValue(`V${i + 1}`) || '0';
    let part = '0';
    if (src.startsWith('DI:')) {
      const name = src.slice(3);
      part = `DI_Get(IDX_${name})${cmp}${val}`;
    } else if (src.startsWith('VAR:')) {
      const name = src.slice(4);
      part = `${name}${cmp}${val}`;
    }
    if (i === 0) {
      expr = part;
    } else {
      const logic = block.getFieldValue(`LOGIC${i}`) || 'AND';
      expr += logic === 'AND' ? `&&${part}` : `||${part}`;
    }
  }
  return expr;
}

function outMacro(val) {
  if (!val || val === 'NONE') return '/* (unbound) */';
  if (val.startsWith('DO:')) return `output_high(DO_${val.slice(3)})`;
  if (val.startsWith('SR:')) return `SR595_SetBit(B595_${val.slice(3).replace(/[^a-z0-9_]/gi, '_')})`;
  return `output_high(DO_${val})`;
}

function outMacroClear(val) {
  if (!val || val === 'NONE') return '/* (unbound) */';
  if (val.startsWith('DO:')) return `output_low(DO_${val.slice(3)})`;
  if (val.startsWith('SR:')) return `SR595_ClrBit(B595_${val.slice(3).replace(/[^a-z0-9_]/gi, '_')})`;
  return `output_low(DO_${val})`;
}

let sn = 0;
let eepromVars = new Set();
let userDefinedFunctions = new Set(); // Quản lý danh sách chương trình con

function gc(block, tname) {
  const map = {
    b_task_begin: (b) => gStmt(b, 'S', tname),
    b_emit: (b) => {
      if (gc.__inStep) return `        EVT_Emit(${b.getFieldValue('EV')});\n`;
      return `    case ${tname}_S${sn}:\n` +
             `        EVT_Emit(${b.getFieldValue('EV')});\n` +
             `        ${tname}_state=${tname}_S${++sn};\n` +
             `        break;\n`;
    },

    // ═════════════════════════════════════════════════════════════════════
    // b_step  —  BƯỚC LINH ĐỘNG (Đã sửa lỗi bọc ngoặc nhọn giúp bọc biến cục bộ)
    // ═════════════════════════════════════════════════════════════════════
    b_step: (b) => {
      const label      = b.getFieldValue('LABEL') || '';
      const thisState  = sn;
      const nextState  = thisState + 1;

      const prevInStep = gc.__inStep;
      const prevNext   = gc.__stepNextSn;
      gc.__inStep      = true;
      gc.__stepNextSn  = nextState;

      const bodyCode = gStmt(b, 'BODY', tname);

      gc.__inStep     = prevInStep;
      gc.__stepNextSn = prevNext;

      const labelComment = label
        ? `    /* ══ STEP [${label}] = S${thisState} ══ */\n`
        : `    /* ══ STEP S${thisState} ══ */\n`;

      // Bọc toàn bộ nội dung case bằng ngoặc nhọn để CCS Compiler cho phép gọi chương trình con & biến cục bộ thoải mái
      const out = labelComment +
        `    case ${tname}_S${thisState}: {\n` +
        bodyCode +
        `        break; /* end STEP ${thisState} */\n` +
        `    }\n`;

      sn = nextState;
      return out;
    },

    b_next_step: (_b) => {
      const next = gc.__stepNextSn !== undefined ? gc.__stepNextSn : sn + 1;
      return `            ${tname}_state = ${tname}_S${next};\n            break;\n`;
    },

    b_goto_step: (b) => {
      const target = (b.getFieldValue('TARGET') || '0').trim();
      const isNum  = /^\d+$/.test(target);
      const stateExpr = isNum
        ? `${tname}_S${target}`
        : (gc.__stepLabelMap && gc.__stepLabelMap[target] !== undefined)
            ? `${tname}_S${gc.__stepLabelMap[target]}`
            : `${tname}_S${target}`;
      return `            ${tname}_state = ${stateExpr};\n            break;\n`;
    },

    b_var_control_by_btn: (b) => {
      const varName = b.getFieldValue('V');
      eepromVars.add(varName);
      const eepromList = Array.from(eepromVars);
      const addr = eepromList.indexOf(varName);

      const startState = sn;
      const waitReleaseInc = ++sn;
      const waitReleaseDec = ++sn;

      return `    /* --- CONTROL VARIABLE ${varName} BY BUTTONS --- */\n` +
             `    case ${tname}_S${startState}:\n` +
             `        if(DI_Get(IDX_${b.getFieldValue('DI_INC')}) == 0) {\n` +
             `            ${varName}++;\n` +
             `            write_eeprom(${addr}, ${varName});\n` +
             `            ${tname}_state = ${tname}_S${waitReleaseInc};\n` +
             `            break;\n` +
             `        }\n` +
             `        if(DI_Get(IDX_${b.getFieldValue('DI_DEC')}) == 0) {\n` +
             `            if(${varName} > 0) ${varName}--;\n` +
             `            write_eeprom(${addr}, ${varName});\n` +
             `            ${tname}_state = ${tname}_S${waitReleaseDec};\n` +
             `            break;\n` +
             `        }\n` +
             `        break;\n` +
             `        \n` +
             `    case ${tname}_S${waitReleaseInc}:\n` +
             `        if(DI_Get(IDX_${b.getFieldValue('DI_INC')}) == 1) {\n` +
             `            ${tname}_state = ${tname}_S${++sn};\n` +
             `        }\n` +
             `        break;\n` +
             `        \n` +
             `    case ${tname}_S${waitReleaseDec}:\n` +
             `        if(DI_Get(IDX_${b.getFieldValue('DI_DEC')}) == 1) {\n` +
             `            ${tname}_state = ${tname}_S${sn};\n` +
             `        }\n` +
             `        break;\n`;
    },

    b_wait_all: (b) => {
      const evs = b.getFieldValue('EVS');
      if (gc.__inStep) return `        if(!EVT_HasAll(${evs})) break;\n        EVT_Clear(${evs});\n`;
      return `    case ${tname}_S${sn}:\n` +
             `        if(!EVT_HasAll(${evs})) break;\n` +
             `        EVT_Clear(${evs});\n` +
             `        ${tname}_state=${tname}_S${++sn};\n` +
             `        break;\n`;
    },

    b_wait_any: (b) => {
      let evs = b.getFieldValue('EVS').split(',').map(e => e.trim()).join(' | ');
      let rawEvs = b.getFieldValue('EVS');
      if (gc.__inStep) return `        if(!EVT_HasAny(${evs})) break;\n        EVT_Clear(${rawEvs});\n`;
      return `    case ${tname}_S${sn}:\n` +
             `        if(!EVT_HasAny(${evs})) break;\n` +
             `        EVT_Clear(${rawEvs});\n` +
             `        ${tname}_state=${tname}_S${++sn};\n` +
             `        break;\n`;
    },

    b_task_restart: (b) => {
      const targetTask = b.getFieldValue('TASK_NAME') || tname;
      if (targetTask === tname) {
        return `            Delay_NB_Reset(&${tname}_dly);\n` +
               `            ${tname}_state = ${tname}_S0;\n` +
               `            break;\n`;
      } 
      if (gc.__inStep) {
        return `        ${targetTask}_state = ${targetTask}_S0;\n        Delay_NB_Reset(&${targetTask}_dly);\n`;
      }
      return `    case ${tname}_S${sn}:\n` +
             `        ${targetTask}_state = ${targetTask}_S0;\n` +
             `        Delay_NB_Reset(&${targetTask}_dly);\n` +
             `        ${tname}_state = ${tname}_S${++sn};\n` +
             `        break;\n`;
    },

    b_task_done: () => `    ${tname}_state=${tname}_DONE;\n    break;\n`,

   b_delay: (b) => {
      // NẾU NẰM TRONG B_STEP: Không dùng while nữa, dùng if và return để phi chặn tuyệt đối
      if (gc.__inStep) {
        return `        if(!Delay_NB(&${tname}_dly, ${b.getFieldValue('MS')})) return;\n`;
      }
      // Ngoài b_step (mã gốc của bạn)
      return `    case ${tname}_S${sn}:\n        if(Delay_NB(&${tname}_dly, ${b.getFieldValue('MS')})){\n            ${tname}_state = ${tname}_S${++sn};\n        }\n        break;\n`;
    },

   b_delay_var_dropdown: (b) => {
      const varName = b.getFieldValue('V'); 
      if (tname === 'SCHEDULER') {
          return `    HAL_Delay(${varName});\n`;
      }
      if (gc.__inStep) {
        return `        if(!Delay_NB(&${tname}_dly, ${varName})) return;\n`;
      }
      return `    case ${tname}_S${sn}:\n        if(Delay_NB(&${tname}_dly, ${varName})){\n            ${tname}_state = ${tname}_S${++sn};\n        }\n        break;\n`;
    },

    b_loop_n: (b) => {
      const n = b.getFieldValue('N') || '1';
      const bodyCode = gStmt(b, 'DO', tname);
      
      // Nếu nằm trong b_step, giải phóng vòng lặp phẳng cấu trúc C chuẩn (Sử dụng biến cục bộ tránh tràn bộ nhớ PIC)
      if (gc.__inStep) {
        const loopVarId = Math.floor(Math.random() * 1000);
        return `        {\n` +
               `            uint16_t loop_i_${loopVarId};\n` +
               `            for(loop_i_${loopVarId} = 0; loop_i_${loopVarId} < ${n}; loop_i_${loopVarId}++) {\n` +
               `${bodyCode}` +
               `            }\n` +
               `        }\n`;
      }

      // Logic gốc ngoài b_step của bạn giữ nguyên:
      const loopIdx = sn; 
      const startState = `${tname}_S${loopIdx}`;
      let out = `    case ${startState}:\n        ${tname}_loop_${loopIdx} = 0;\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
      const bodyStateIdx = sn;
      out += bodyCode;
      out += `    case ${tname}_S${sn}:\n        ${tname}_loop_${loopIdx}++;\n        if(${tname}_loop_${loopIdx} < ${n}){\n            ${tname}_state=${tname}_S${bodyStateIdx};\n        } else {\n            ${tname}_state=${tname}_S${++sn};\n        }\n        break;\n`;
      return out;
    },
    
    b_timeout_sensor: (b) => {
      const di_name = b.getFieldValue('DI') || 'NONE';
      const target_val = b.getFieldValue('V') || '1';
      const timeout_ms = b.getFieldValue('MS') || '4000';
      const error_msg = b.getFieldValue('MSG') || 'Error Timeout';
      
      if (gc.__inStep) {
        return `        ${tname}_t0 = GetTick();\n` +
               `        while(1) {\n` +
               `            if(${target_val === '1' ? '' : '!'}DI_Get(IDX_${di_name})) break;\n` +
               `            if(Timeout(${tname}_t0, ${timeout_ms})) {\n` +
               `                g_err = 1;\n` +
               `                fprintf(HOST_PC, "\\r\\n[TIMEOUT ERROR] Task '${tname}': ${error_msg}\\r\\n");\n` +
               `                ${tname}_state = ${tname}_ERR; break;\n` +
               `            }\n` +
               `        }\n`;
      }

      let out = `    case ${tname}_S${sn}:\n` +
                `        ${tname}_t0 = GetTick();\n` +
                `        ${tname}_state = ${tname}_S${++sn};\n` +
                `        break;\n` +
                `    case ${tname}_S${sn}:\n`;
      if (target_val === '1') {
        out += `        if(DI_Get(IDX_${di_name})) {\n`;
      } else {
        out += `        if(!DI_Get(IDX_${di_name})) {\n`;
      }
      out += `            ${tname}_state = ${tname}_S${++sn};\n` +
            `        }\n` +
            `        else if(Timeout(${tname}_t0, ${timeout_ms})) {\n` +
            `            g_err = 1;\n` +
            `            fprintf(HOST_PC, "\\r\\n[TIMEOUT ERROR] Task '${tname}': ${error_msg}\\r\\n");\n` +
            `            ${tname}_state = ${tname}_ERR;\n` +
            `        }\n` +
            `        break;\n`;
      return out;
    },

    b_loop_while: (b) => `    while(DI_Get(IDX_${b.getFieldValue('DI')})==${b.getFieldValue('V')}){\n${gStmt(b, 'DO', tname)}\n    }\n`,
    b_wait_di_on: (b) => {
      if (gc.__inStep) return `        while(DI_Get(IDX_${b.getFieldValue('DI')}));\n`;
      return `    case ${tname}_S${sn}:\n        if(!DI_Get(IDX_${b.getFieldValue('DI')})) ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_wait_di_off: (b) => {
      if (gc.__inStep) return `        while(!DI_Get(IDX_${b.getFieldValue('DI')}));\n`;
      return `    case ${tname}_S${sn}:\n        if(DI_Get(IDX_${b.getFieldValue('DI')})) ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },

    b_if_multi: (b) => {
      if (tname === 'SCHEDULER' || gc.__inStep) {
        const cond = buildMultiCond(b);
        const thenCode = gStmt(b, 'DO', tname);
        const elseCode = gStmt(b, 'ELSE', tname);
        let out = `        if (${cond}) {\n${thenCode}        }`;
        if (elseCode.trim()) {
          out += ` else {\n${elseCode}        }`;
        }
        return out + '\n';
      }
      
      const condState = sn; sn++; 
      const thenStartSn = sn;
      const thenCode = gStmt(b, 'DO', tname);
      const thenEndSn = sn; sn++; 
      const elseStartSn = sn;
      const elseCode = gStmt(b, 'ELSE', tname);
      const mergeState = sn; 
      return (
        `    case ${tname}_S${condState}:\n` +
        `        if(${buildMultiCond(b)}) ${tname}_state=${tname}_S${thenStartSn};\n` +
        `        break;\n` +
        thenCode +
        `    case ${tname}_S${thenEndSn}:\n` +
        `        ${tname}_state=${tname}_S${mergeState};\n` +
        `        break;\n` +
        elseCode
      );
    },

    b_if_var: (b) => {
      if (tname === 'SCHEDULER' || gc.__inStep) {
        const cond = `${b.getFieldValue('V')}${b.getFieldValue('OP')}${b.getFieldValue('VAL')}`;
        const thenCode = gStmt(b, 'DO', tname);
        const elseCode = gStmt(b, 'ELSE', tname);
        let out = `        if (${cond}) {\n${thenCode}        }`;
        if (elseCode.trim()) {
          out += ` else {\n${elseCode}        }`;
        }
        return out + '\n';
      }

      const condState = sn; sn++;
      const thenStartSn = sn;
      const thenCode = gStmt(b, 'DO', tname);
      const thenEndSn = sn; sn++;
      const elseStartSn = sn;
      const elseCode = gStmt(b, 'ELSE', tname);
      const mergeState = sn;
      return (
        `    case ${tname}_S${condState}:\n` +
        `        if(${b.getFieldValue('V')}${b.getFieldValue('OP')}${b.getFieldValue('VAL')}) ${tname}_state=${tname}_S${thenStartSn};\n` +
        `        break;\n` +
        thenCode +
        `    case ${tname}_S${thenEndSn}:\n` +
        `        ${tname}_state=${tname}_S${mergeState};\n` +
        `        break;\n` +
        elseCode
      );
    },
    
    b_do_set: (b) => {
      if (gc.__inStep) return `        ${outMacro('DO:' + b.getFieldValue('DO'))};\n`;
      return `    case ${tname}_S${sn}:\n        ${outMacro('DO:' + b.getFieldValue('DO'))};\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_do_clr: (b) => {
      if (gc.__inStep) return `        ${outMacroClear('DO:' + b.getFieldValue('DO'))};\n`;
      return `    case ${tname}_S${sn}:\n        ${outMacroClear('DO:' + b.getFieldValue('DO'))};\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_do_tog: (b) => {
      if (gc.__inStep) return `        output_toggle(DO_${b.getFieldValue('DO')});\n`;
      return `    case ${tname}_S${sn}:\n        output_toggle(DO_${b.getFieldValue('DO')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_do_pulse: (b) => {
      if (gc.__inStep) return `        output_high(DO_${b.getFieldValue('DO')});\n`;
      return `    case ${tname}_S${sn}:\n        output_high(DO_${b.getFieldValue('DO')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_sr_set: (b) => {
      if (gc.__inStep) return `        SR595_SetBit(B595_${b.getFieldValue('B').replace(/[^a-z0-9_]/gi, '_')});\n`;
      return `    case ${tname}_S${sn}:\n        SR595_SetBit(B595_${b.getFieldValue('B').replace(/[^a-z0-9_]/gi, '_')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_sr_clr: (b) => {
      if (gc.__inStep) return `        SR595_ClrBit(B595_${b.getFieldValue('B').replace(/[^a-z0-9_]/gi, '_')});\n`;
      return `    case ${tname}_S${sn}:\n        SR595_ClrBit(B595_${b.getFieldValue('B').replace(/[^a-z0-9_]/gi, '_')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_sr_pulse: (b) => {
      const bitName = b.getFieldValue('B').replace(/[^a-z0-9_]/gi, '_');
      const pulseMs = b.getFieldValue('MS') || '200'; 
      if (gc.__inStep) {
        return `        SR595_SetBit(B595_${bitName});\n` +
               `        while(!Delay_NB(&${tname}_dly, ${pulseMs}));\n` +
               `        SR595_ClrBit(B595_${bitName});\n`;
      }
      const startState = sn; const waitState = ++sn;
      return `    /* --- PULSE BIT B595_${bitName} (${pulseMs}ms) --- */\n` +
             `    case ${tname}_S${startState}:\n` +
             `        SR595_SetBit(B595_${bitName});\n` +
             `        ${tname}_state = ${tname}_S${waitState};\n` +
             `        break;\n` +
             `    case ${tname}_S${waitState}:\n` +
             `        if(Delay_NB(&${tname}_dly, ${pulseMs})) {\n` +
             `            SR595_ClrBit(B595_${bitName});\n` +
             `            ${tname}_state = ${tname}_S${++sn};\n` +
             `        }\n` +
             `        break;\n`;
    },
    b_sr_blink_forever: (b) => {
      const bitName = b.getFieldValue('B').replace(/[^a-z0-9_]/gi, '_');
      const msOn = b.getFieldValue('MS_ON') || '500';
      const msOff = b.getFieldValue('MS_OFF') || '500';
      const startState = sn; const waitOnState = ++sn; const waitOffState = ++sn;
      return `    /* --- BLINK FOREVER B595_${bitName} --- */\n` +
             `    case ${tname}_S${startState}:\n` +
             `        SR595_SetBit(B595_${bitName});\n` +
             `        ${tname}_state = ${tname}_S${waitOnState};\n` +
             `        break;\n` +
             `    case ${tname}_S${waitOnState}:\n` +
             `        if(Delay_NB(&${tname}_dly, ${msOn})) {\n` +
             `            SR595_ClrBit(B595_${bitName});\n` +
             `            ${tname}_state = ${tname}_S${waitOffState};\n` +
             `        }\n` +
             `        break;\n` +
             `    case ${tname}_S${waitOffState}:\n` +
             `        if(Delay_NB(&${tname}_dly, ${msOff})) {\n` +
             `            ${tname}_state = ${tname}_S${startState};\n` +
             `        }\n` +
             `        break;\n`;
    },
    b_sr_byte: (b) => {
      if (gc.__inStep) return `        SR595_WriteByte(${b.getFieldValue('IC')},0x${b.getFieldValue('V')});\n`;
      return `    case ${tname}_S${sn}:\n        SR595_WriteByte(${b.getFieldValue('IC')},0x${b.getFieldValue('V')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    
   b_cyl_ext: (b) => {
      const c = cylList.find((x) => x.name === b.getFieldValue('C')) || {};
      if (gc.__inStep) {
        // Sử dụng một cờ hoặc kiểm tra thời gian phi chặn, nếu chưa xong thì return
        return `        ${outMacro(c.out_ext)}; ${outMacroClear(c.out_ret)} \n` +
               `        if(!(DI_Get(IDX_${c.sen_ext || 'NONE'}) || (GetTick() - ${tname}_t0 >= ${c.timeout || 4000}))) {\n` +
               `            if(${tname}_t0 == 0) ${tname}_t0 = GetTick();\n` +
               `            return;\n` +
               `        }\n` +
               `        ${tname}_t0 = 0; // reset t0\n` +
               `        ${outMacroClear(c.out_ext)} \n`;
      }
      return `    /* ${b.getFieldValue('C')} EXT */\n    case ${tname}_S${sn}:\n        if(${tname}_t0==0) ${tname}_t0=GetTick();\n        ${outMacro(c.out_ext)}; ${outMacroClear(c.out_ret)};\n        if(DI_Get(IDX_${c.sen_ext || 'NONE'})||Timeout(${tname}_t0,${c.timeout || 4000})){\n            ${outMacroClear(c.out_ext)}; ${tname}_t0=0; ${tname}_state=${tname}_S${++sn};\n        }\n        break;\n`;
    },
    b_cyl_ret: (b) => {
      const c = cylList.find((x) => x.name === b.getFieldValue('C')) || {};
      if (gc.__inStep) {
         return `        ${outMacro(c.out_ext)}; ${outMacroClear(c.out_ret)} \n` +
               `        if(!(DI_Get(IDX_${c.sen_ext || 'NONE'}) || (GetTick() - ${tname}_t0 >= ${c.timeout || 4000}))) {\n` +
               `            if(${tname}_t0 == 0) ${tname}_t0 = GetTick();\n` +
               `            return;\n` +
               `        }\n` +
               `        ${tname}_t0 = 0; // reset t0\n` +
               `        ${outMacroClear(c.out_ext)} \n`;
      }
      return `    /* ${b.getFieldValue('C')} RET */\n    case ${tname}_S${sn}:\n        ${outMacro(c.out_ret)}; ${outMacroClear(c.out_ext)};\n        if(DI_Get(IDX_${c.sen_ret || 'NONE'})||Timeout(${tname}_t0,${c.timeout || 4000})){\n            ${outMacroClear(c.out_ret)}; ${tname}_state=${tname}_S${++sn};\n        }\n        break;\n`;
    },
    b_cyl_wait_ext: (b) => {
      const c = cylList.find((x) => x.name === b.getFieldValue('C')) || {};
      if (gc.__inStep) return `        while(!DI_Get(IDX_${c.sen_ext || 'NONE'}));\n`;
      return `    case ${tname}_S${sn}:\n        if(DI_Get(IDX_${c.sen_ext || 'NONE'})) ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_cyl_wait_ret: (b) => {
      const c = cylList.find((x) => x.name === b.getFieldValue('C')) || {};
      if (gc.__inStep) return `        while(!DI_Get(IDX_${c.sen_ret || 'NONE'}));\n`;
      return `    case ${tname}_S${sn}:\n        if(DI_Get(IDX_${c.sen_ret || 'NONE'})) ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_mot_run_sen: (b) => {
      const m = motList.find((x) => x.name === b.getFieldValue('M')) || {};
      const dir = b.getFieldValue('D');
      const sen = dir === 'FWD' ? m.sen_fwd : m.sen_rev;
      if (gc.__inStep) {
        return `        ${outMacro(m.out_en)}; ${dir === 'FWD' ? `output_high(DO_${m.out_dir.slice(3)})` : `output_low(DO_${m.out_dir.slice(3)})`}; ${tname}_t0 = GetTick();\n` +
               `        while(!(DI_Get(IDX_${sen || 'NONE'}) || Timeout(${tname}_t0, ${m.timeout || 5000})));\n` +
               `        ${outMacroClear(m.out_en)};\n`;
      }
      return `    /* ${b.getFieldValue('M')} ${dir} to sensor */\n    case ${tname}_S${sn}:\n        ${outMacro(m.out_en)};\n        if(${dir === 'FWD' ? `output_high(DO_${m.out_dir.slice(3)})` : `output_low(DO_${m.out_dir.slice(3)})`});\n        if(DI_Get(IDX_${sen || 'NONE'})||Timeout(${tname}_t0,${m.timeout || 5000})){\n            ${outMacroClear(m.out_en)}; ${tname}_state=${tname}_S${++sn};\n        }\n        break;\n`;
    },
    b_mot_run_time: (b) => {
      const m = motList.find((x) => x.name === b.getFieldValue('M')) || {};
      const dir = b.getFieldValue('D');
      if (gc.__inStep) {
        return `        ${outMacro(m.out_en)}; ${dir === 'FWD' ? `output_high(DO_${m.out_dir.slice(3)})` : `output_low(DO_${m.out_dir.slice(3)})`}; ${tname}_t0 = GetTick();\n` +
               `        while(!Timeout(${tname}_t0, ${b.getFieldValue('T')}));\n` +
               `        ${outMacroClear(m.out_en)};\n`;
      }
      return `    case ${tname}_S${sn}:\n        ${outMacro(m.out_en)}; if(${dir === 'FWD' ? `output_high(DO_${m.out_dir.slice(3)})` : `output_low(DO_${m.out_dir.slice(3)})`});\n        if(Timeout(${tname}_t0,${b.getFieldValue('T')})){${outMacroClear(m.out_en)}; ${tname}_state=${tname}_S${++sn};}\n        break;\n`;
    },
    b_mot_stop: (b) => {
      const m = motList.find((x) => x.name === b.getFieldValue('M')) || {};
      if (gc.__inStep) return `        ${outMacroClear(m.out_en)};\n`;
      return `    case ${tname}_S${sn}:\n        ${outMacroClear(m.out_en)};\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_mot_wait: () => `    /* wait motor done */\n`,
    
    b_var_set: (b) => {
      if (tname === 'SCHEDULER' || gc.__inStep) {
        return `        ${b.getFieldValue('V')} = ${b.getFieldValue('VAL')};\n`;
      }
      return `    case ${tname}_S${sn}:\n` +
             `        ${b.getFieldValue('V')} = ${b.getFieldValue('VAL')};\n` +
             `        ${tname}_state = ${tname}_S${++sn};\n` +
             `        break;\n`;
    },
    b_var_inc: (b) => {
      if (tname === 'SCHEDULER' || gc.__inStep) {
        return `        ${b.getFieldValue('V')}++;\n`;
      }
      return `    case ${tname}_S${sn}:\n` +
             `        ${b.getFieldValue('V')}++;\n` +
             `        ${tname}_state = ${tname}_S${++sn};\n` +
             `        break;\n`;
    },
    b_var_dec: (b) => {
      if (tname === 'SCHEDULER' || gc.__inStep) {
        return `        ${b.getFieldValue('V')}--;\n`;
      }
      return `    case ${tname}_S${sn}:\n` +
             `        ${b.getFieldValue('V')}--;\n` +
             `        ${tname}_state = ${tname}_S${++sn};\n` +
             `        break;\n`;
    },

    // ─────────────────────────────────────────────────────────────────────
    // GIỮ NGUYÊN BLOCK LCD TỰ ĐỘNG XÓA VÀ GHI CHUẨN CỦA BẠN
    // ─────────────────────────────────────────────────────────────────────
    b_lcd_single: (b) => {
      const row = b.getFieldValue('ROW') || '1';
      const col = b.getFieldValue('COL') || '1';
      const type = b.getFieldValue('TYPE') || 'STR';
      let printContent = '';
      if (type === 'STR') {
        printContent = `"${b.getFieldValue('TEXT_VAL') || ''}"`;
      } else if (type === 'VAR') {
        printContent = `"%lu", (uint32_t)${b.getFieldValue('VAR_VAL') || '0'}`;
      }
      return `        lcd_clear_tail(${row}, ${col});\n        lcd_goto(${col}, ${row});\n        printf(LCD_Out, ${printContent});\n`;
    },
    b_lcd_advance: (b) => {
      const row = b.getFieldValue('ROW') || '1';
      const col = b.getFieldValue('COL') || '1';
      let formatStr = b.getFieldValue('FORMAT') || '';
      formatStr = formatStr.replace(/%d/g, '%lu');
      const varArgs = [];
      const count = b.varCount_ || 0;
      for (let i = 0; i < count; i++) {
        const varName = b.getFieldValue('VAR_SELECT' + i) || '0';
        if (varName && varName !== 'NONE') varArgs.push(`(uint32_t)(${varName})`);
        else varArgs.push('0');
      }
      let printContent = `"${formatStr}"`;
      if (varArgs.length > 0) printContent += `, ${varArgs.join(', ')}`;
      return `        lcd_clear_tail(${row}, ${col});\n        lcd_goto(${col}, ${row});\n        printf(LCD_Out, ${printContent});\n`;
    },

    b_button_click: (b) => {
      const btnPin = b.getFieldValue('BTN_PIN') || 'PIN_A0';
      let doCode = gStmt(b, 'DO_BRANCH', tname);
      if (!doCode.trim()) doCode = '        // không làm gì\n';
      if (tname === 'SCHEDULER' || gc.__inStep) {
        return `        if (input_state(DI_${btnPin}) == 0) {\n` +
               `            delay_ms(20);\n` +
               `            if (input_state(DI_${btnPin}) == 0) {\n` +
               `                while (input_state(DI_${btnPin}) == 0);\n` +
               `${doCode}` +
               `            }\n` +
               `        }\n`;
      }
      return `    case ${tname}_S${sn}:\n` +
             `        if (input_state(DI_${btnPin}) == 0) {\n` +
             `            delay_ms(20);\n` +
             `            if (input_state(DI_${btnPin}) == 0) {\n` +
             `                while (input_state(DI_${btnPin}) == 0);\n` +
             `${doCode}` +
             `            }\n` +
             `        }\n         ${tname}_state = ${tname}_S${++sn};\n        break;\n`;
    },
    b_button_hold: (b) => {
      const btnPin = b.getFieldValue('BTN_PIN') || 'PIN_A0';
      const holdTime = b.getFieldValue('HOLD_TIME') || '1000';
      let doCode = gStmt(b, 'DO_BRANCH', tname);
      if (!doCode.trim()) doCode = '            // không làm gì\n';
      if (tname === 'SCHEDULER' || gc.__inStep) {
        return `        if (input_state(DI_${btnPin}) == 0) {\n` +
               `            uint16_t hold_timer = 0;\n` +
               `            while (input_state(DI_${btnPin}) == 0) {\n` +
               `                delay_ms(1);\n` +
               `                hold_timer++;\n` +
               `                if (hold_timer >= ${holdTime}) {\n` +
               `${doCode}` +
               `                    while (input_state(DI_${btnPin}) == 0);\n` +
               `                    break;\n` +
               `                }\n` +
               `            }\n` +
               `        }\n`;
      }
      return `    case ${tname}_S${sn}:\n` +
             `        if (input_state(DI_${btnPin}) == 0) {\n` +
             `            uint16_t hold_timer = 0;\n` +
             `            while (input_state(DI_${btnPin}) == 0) {\n` +
             `                delay_ms(1);\n` +
             `                hold_timer++;\n` +
             `                if (hold_timer >= ${holdTime}) {\n` +
             `${doCode}` +
             `                    while (input_state(DI_${btnPin}) == 0);\n` +
             `                    break;\n` +
             `                }\n` +
             `            }\n` +
             `        }\n        ${tname}_state = ${tname}_S${++sn};\n        break;\n`;
    },
    b_stepper_control: (b) => {
      const motName = b.getFieldValue('MOT_NAME') || 'STEPPER_1';
      const dir = b.getFieldValue('DIR') || '1';
      const steps = b.getFieldValue('STEPS') || '200';
      const delay = b.getFieldValue('SPEED_DELAY') || '2';
      const dirPin = `MOT_DIR_${motName}`;
      const stepPin = `MOT_STEP_${motName}`;
      const stepCode = 
        `        output_bit(${dirPin}, ${dir});\n` +
        `        for(uint16_t i = 0; i < ${steps}; i++) {\n` +
        `            output_high(${stepPin});\n` +
        `            delay_ms(${delay});\n` +
        `            output_low(${stepPin});\n` +
        `            delay_ms(${delay});\n` +
        `        }\n`;
      if (tname !== 'SCHEDULER' && !gc.__inStep) {
        return `    case ${tname}_S${sn}:\n${stepCode}        ${tname}_state = ${tname}_S${++sn};\n        break;\n`;
      }
      return stepCode;
    },

    // ─────────────────────────────────────────────────────────────────────
    // BLOCK ĐỊNH NGHĨA & GỌI CHƯƠNG TRÌNH CON ĐƯỢC THÊM MỚI THEO YÊU CẦU
    // ─────────────────────────────────────────────────────────────────────
    b_define_function: (b) => {
      const funcName = b.getFieldValue('FUNC_NAME') || 'chuongtrinhcon';
      userDefinedFunctions.add(funcName); 
      const funcBody = gStmt(b, 'DO_BRANCH', 'FUNCTION');
      return `void ${funcName}(void) {\n${funcBody}}\n\n`;
    },
    b_call_function: (b) => {
      const funcName = b.getFieldValue('FUNC_NAME') || 'chuongtrinhcon';
      return `        ${funcName}();\n`;
    },

    b_call_task: (b) => {
      const targetTask = b.getFieldValue('TASK_NAME');
      const indent = tname === 'SCHEDULER' ? '        ' : '        ';
      return `${indent}Task_${targetTask}();\n`;
    },
    b_err: () => `    g_err=1; return;\n`,
    b_pass: () => `    SR595_SetBit(B595_LED_PASS); Buzzer_Beep(1);\n`,
    b_fail: () => `    SR595_SetBit(B595_LED_FAIL); g_err=1;\n`,
    b_buzzer: (b) => `    Buzzer_Beep(${b.getFieldValue('N')});\n`,
  };

  const fn = map[block.type];
  return fn ? fn(block) : `    /* [${block.type}] */\n`;
}

function gStmt(b, inp, tn) {
  let c = '';
  let ch = b.getInputTargetBlock(inp);
  while (ch) {
    c += gc(ch, tn);
    ch = ch.getNextBlock();
  }
  return c;
}

function collectEvents() {
  const allEvts = new Set();
  const ws = window.workspace || workspace;
  if (ws) {
    ws.getAllBlocks()
      .filter((b) => ['b_emit', 'b_wait_all', 'b_wait_any'].includes(b.type))
      .forEach((b) => {
        const raw = b.getFieldValue('EV') || b.getFieldValue('EVS') || '';
        raw.split(',').map((e) => e.trim()).forEach((e) => { if (e) allEvts.add(e); });
      });
  }
  return [...allEvts];
}

function getStateList(body, tname) {
  const numbers = new Set();
  const casePattern = new RegExp(`case ${tname}_S(\\d+):`, 'g');
  for (const match of body.matchAll(casePattern)) {
    numbers.add(parseInt(match[1], 10));
  }
  const assignPattern = new RegExp(`${tname}_state\\s*=\\s*(?:${tname}_)?S(\\d+)`, 'g');
  for (const match of body.matchAll(assignPattern)) {
    numbers.add(parseInt(match[1], 10));
  }
  const sortedNumbers = [...numbers].filter(num => num > 0).sort((a, b) => a - b);
  return sortedNumbers.map((num) => `${tname}_S${num}`);
}

function getLoopVars(body, tname) {
  const pattern = new RegExp(`${tname}_loop_(\\d+)`, 'g');
  const matches = [...body.matchAll(pattern)];
  const idxs = [...new Set(matches.map((m) => m[1]))];
  return idxs.map((i) => `uint16_t ${tname}_loop_${i} = 0;`).join('\n');
}

export function buildC() {
  eepromVars.clear();
  userDefinedFunctions.clear(); 
  
  const ds = document.getElementById('p-ds').value || 'PIN_C4';
  const sh = document.getElementById('p-sh').value || 'PIN_C3';
  const st = document.getElementById('p-st').value || 'PIN_C5';
  const ws = window.workspace || workspace;
  
  const tops = ws ? ws.getTopBlocks(true).filter((b) => b.type === 'b_task_begin') : [];
  const funcBlocks = ws ? ws.getTopBlocks(true).filter((b) => b.type === 'b_define_function') : [];

  const formatCcsPin = (p) => {
    if (!p) return 'PIN_A0';
    if (p.toUpperCase().startsWith('PIN_')) return p.toUpperCase();
    return `PIN_${p.toUpperCase().slice(-2)}`;
  };

  const allEvts = collectEvents();

  const doDefs    = doList.filter((d) => d.name).map((d) => `#define DO_${d.name} ${formatCcsPin(d.pin)}`).join('\n');
  const diPinDefs = diList.filter((d) => d.name).map((d) => `#define DI_${d.name} ${formatCcsPin(d.pin)}`).join('\n');
  const diIdxDefs = diList.filter((d) => d.name).map((d, i) => `#define IDX_${d.name} ${i}`).join('\n');
  const srDefs    = bits595.map((b, i) => `#define B595_${b.name.replace(/[^a-z0-9_]/gi, '_')} ${i}`).join('\n');

  const varDefs = varList.filter((v) => v.name).map((v) => {
    let type = v.type;
    if (type === 'uint8_t'  || type === 'unsigned int8')  type = 'int8';
    if (type === 'uint16_t' || type === 'unsigned int16') type = 'int16';
    if (type === 'uint32_t' || type === 'unsigned int32') type = 'int32';
    return `${type} ${v.name}=${v.init || 0};`;
  }).join('\n');

  const evtDefs = allEvts.map((e, i) => `#define ${e} (1UL<<${i})`).join('\n');

  const diFiltered  = diList.filter((d) => d.name);
  const varFiltered = varList.filter((v) => v.name);

  const inPrintLines = diFiltered.map((d, i) => `    printf("IN ${d.name}=%c\\r\\n", DI_Get(${i}) ? '1' : '0');`).join('\n');
  const outPrintLines = bits595.map((b, i) => `    printf("OUT ${b.name || 'Q'+i}=%u\\r\\n", (unsigned)(sr[${i}>>3]>>(${i}&7))&1);`).join('\n');
  const varPrintLines = varFiltered.map((v) => `    printf("${v.name}=%ld\\r\\n", (long)${v.name});`).join('\n');

  const parsePinBody = [
    ...bits595.map((b, i) => `    if(strcmp(name, (char*)"${b.name || 'Q'+i}") == 0) return ${i};`),
    `    if((name[0]=='d'||name[0]=='D') && name[1]>='0' && name[1]<='9'){`,
    `        int n=my_atoi(name+1);`,
    `        if(n>=0 && n<${bits595.length}) return n;`,
    `    }`,
  ].join('\n');

  // Sinh mã chương trình con trước để bộ thu thập cập nhật đầy đủ tên hàm
  const functionsSourceCode = funcBlocks.map((b) => gc(b, 'GLOBAL')).join('\n');
  const functionPrototypes = Array.from(userDefinedFunctions).map(f => `void ${f}(void);`).join('\n');

  const taskFuncs = tops
    .map((b) => {
      sn = 0;
      const tn = b.getFieldValue('TK');
      const body = gStmt(b, 'S', tn);
      const states = getStateList(body, tn).join(', ');
      const loopVars = getLoopVars(body, tn);
      return (
        `/* --- TASK: ${tn} ----------------------- */\n` +
        `typedef enum { ${tn}_S0${states ? `, ${states}` : ''} , ${tn}_DONE, ${tn}_ERR } ${tn}_St;\n` +
        `${tn}_St ${tn}_state = ${tn}_S0;\n` +
        `uint32_t ${tn}_t0 = 0;\n` +
        `DelayNB_t ${tn}_dly;\n` +
        `${loopVars || ''}\n\n` +
        `void Task_${tn}(void) {\n` +
        `    if(g_err) return;\n` +
        `    switch(${tn}_state) {\n` +
        `${body.split('\n').map((l) => (l ? `        ${l}` : l)).join('\n')}\n` +
        `        case ${tn}_DONE: break;\n` +
        `        case ${tn}_ERR:  g_err=1; break;\n` +
        `        default: break;\n` +
        `    }\n}`
      );
    })
    .join('\n\n');

  // NẠP ĐẦY ĐỦ LOGIC ĐỌC EEPROM GIỮ NGUYÊN CỦA BẠN
  const eepromLoadCode = Array.from(eepromVars).map((vName, index) => {
      return `    ${vName} = read_eeprom(${index});`;
  }).join('\n');

  // THƯ VIỆN ĐIỀU KHIỂN LCD CHÈN VÀO FILE C GIỮ NGUYÊN GỐC
  const lcdLibraryCode = `
/* ======================================================== */
/* --- THƯ VIỆN ĐIỀU KHIỂN LCD (AUTO INTEGRATED) ---------- */
/* ======================================================== */
#define LCD_DATA_PIN PIN_e2
#define LCD_CLOCK_PIN PIN_d2
#define LCD_EN_PIN PIN_D1

#define LCD_FIRST_ROW          0x80
#define LCD_SECOND_ROW         0xC0
#define LCD_THIRD_ROW          0x94
#define LCD_FOURTH_ROW         0xD4
#define LCD_CLEAR              0x01
#define LCD_RETURN_HOME        0x02
#define LCD_CURSOR_OFF         0x0C

short RS;

void lcd_write_nibble(unsigned int8 n){
  unsigned int8 i;
  output_low(LCD_CLOCK_PIN);
  output_low(LCD_EN_PIN);
  for( i = 8; i > 0; i = i >> 1){
    if(n & i) output_high(LCD_DATA_PIN);
    else output_low(LCD_DATA_PIN);
    delay_us(10);
    output_high(LCD_CLOCK_PIN);
    delay_us(10);
    output_low(LCD_CLOCK_PIN);
  }
  if(RS) output_high(LCD_DATA_PIN);
  else output_low(LCD_DATA_PIN);
  for(i = 0; i < 2; i++){
    delay_us(10);
    output_high(LCD_CLOCK_PIN);
    delay_us(10);
    output_low(LCD_CLOCK_PIN);
  }
  output_high(LCD_EN_PIN);
  delay_us(2);
  output_low(LCD_EN_PIN);
}

void LCD_Cmd(unsigned int8 Command){
  RS = 0;
  lcd_write_nibble(Command >> 4);
  lcd_write_nibble(Command & 0x0F);
  if((Command == 0x0C) || (Command == 0x01) || (Command == 0x02))
    delay_ms(50);
}

void lcd_goto(unsigned int8 col, unsigned int8 row){
  switch(row){
    case 1: LCD_Cmd(0x80 + col-1); break;
    case 2: LCD_Cmd(0xC0 + col-1); break;
    case 3: LCD_Cmd(0x94 + col-1); break;
    case 4: LCD_Cmd(0xD4 + col-1); break;
  }
}

void LCD_Out(unsigned int8 LCD_Char){
  RS = 1;  
  lcd_write_nibble(LCD_Char >> 4);
  delay_us(10);
  lcd_write_nibble(LCD_Char & 0x0F);
}

void LCD_PrintStr(char* str) {
    while(*str) { LCD_Out(*str); str++; }
}

void lcd_clear_tail(uint8_t row, uint8_t from_col) {
    lcd_goto(from_col, row);
    for(uint8_t i = from_col; i <= 20; i++) {
        printf(LCD_Out, " ");
    }
}
void LCD_Initialize(){
  RS = 0;
  output_low(LCD_DATA_PIN);
  output_low(LCD_CLOCK_PIN);
  output_low(LCD_EN_PIN);
  output_drive(LCD_DATA_PIN);
  output_drive(LCD_CLOCK_PIN);
  output_drive(LCD_EN_PIN);
  delay_ms(40);
  LCD_Cmd(3); delay_ms(5);
  LCD_Cmd(3); delay_ms(5);
  LCD_Cmd(3); delay_ms(5);
  LCD_Cmd(2); delay_ms(5);
  LCD_Cmd(0x28); delay_ms(50);
  LCD_Cmd(0x0C); delay_ms(50);
  LCD_Cmd(0x06); delay_ms(50);
  LCD_Cmd(0x0C); delay_ms(50);
}
/* ======================================================== */
`;

  const schedulerRoot = ws ? ws.getAllBlocks().find((b) => b.type === 'b_scheduler_root') : null;
  let schedulerContent = schedulerRoot ? gStmt(schedulerRoot, 'DO', 'SCHEDULER') : tops.map(b => `    Task_${b.getFieldValue('TK')}();`).join('\n');

  return `/*************************************************************
 * JIGSIM v4 - Cooperative Multi-Task Scheduler (CCS Compiler)
 *************************************************************/
#include <main.h>
#include <string.h>
#use delay(crystal=20000000)
#use rs232(baud=115200, xmit=PIN_C6, rcv=PIN_C7, stream=HOST_PC)

typedef int8  uint8_t;
typedef int16 uint16_t;
typedef int32 uint32_t;

/* --- OUTPUT HARDWARE PINS ------------------- */
${doDefs || '/* none */'}

/* --- INPUT HARDWARE PINS -------------------- */
${diPinDefs || '/* none */'}

/* --- INPUT DEBOUNCE INDEX ------------------- */
${diIdxDefs || '/* none */'}

${lcdLibraryCode || '/* none */'}

/* --- 595 BIT NAMES -------------------------- */
${srDefs}

/* --- EVENT FLAGS ---------------------------- */
${evtDefs || '/* no events */'}
uint32_t g_evt = 0;
void EVT_Emit(uint32_t mask)   { g_evt |=  mask; }
void EVT_Clear(uint32_t mask)  { g_evt &= ~mask; }
uint8_t EVT_HasAll(uint32_t m) { return (g_evt & m)==m; }
uint8_t EVT_HasAny(uint32_t m) { return (g_evt & m)!=0; }

/* --- USER VARIABLES ------------------------- */
${varDefs || '/* none */'}
uint8_t  g_err        = 0;
uint8_t  giaotiep     = 0;
uint8_t  manual       = 0;
char     rx_buf[32];
uint8_t  rx_idx       = 0;
uint32_t g_debug_tick = 0;

/* --- FUNCTION PROTOTYPES -------------------- */
${functionPrototypes || '/* No sub-routines */'}

/* --- TICK TIMER - 1ms interrupt bang TIMER2 -- */
volatile uint32_t g_tick = 0;
#int_TIMER2
void TIMER2_isr(void) { g_tick++; }
uint32_t GetTick(void) { return g_tick; }
uint8_t  Timeout(uint32_t s, uint32_t d) { return (GetTick()-s) >= d; }

typedef struct { uint32_t t; uint8_t  a; } DelayNB_t;
uint8_t Delay_NB(DelayNB_t* d, uint32_t ms) {
    if(!d->a) { d->t = GetTick(); d->a = 1; return 0; }
    if(Timeout(d->t, ms)) { d->a = 0; return 1; }
    return 0;
}
void Delay_NB_Reset(DelayNB_t* d) { d->a = 0; }

/* --- DEBOUNCE INPUT ------------------------- */
#define DI_N ${diList.filter(d=>d.name).length}
typedef struct { uint8_t  r, s, p; uint32_t lc; } DI_t;
DI_t di[DI_N];

void DI_Update(void) {
    uint8_t i;
${diList.filter(d=>d.name).map((d,i)=>`    di[${i}].r = ${d.active==='LOW'?`!input(DI_${d.name})`:`input(DI_${d.name})`};`).join('\n')}
    for(i=0; i<DI_N; i++) {
        if(di[i].r != di[i].s) { if(Timeout(di[i].lc,20)) { di[i].p=di[i].s; di[i].s=di[i].r; } }
        else di[i].lc = GetTick();
    }
}
uint8_t DI_Get(uint8_t i)  { return i<DI_N ? di[i].s : 0; }
uint8_t DI_Rise(uint8_t i) { if(i<DI_N && di[i].s && !di[i].p){ di[i].p=1; return 1; } return 0; }

/* --- 74HC595 - 3IC daisy-chain bit-bang ----- */
#define SR_DS  ${formatCcsPin(ds)}
#define SR_SH  ${formatCcsPin(sh)}
#define SR_ST  ${formatCcsPin(st)}
uint8_t sr[3] = {0, 0, 0};

void SR595_Latch(void) {
    signed int8 ic, b;
    output_low(SR_ST);
    for(ic=2; ic>-1; ic--) {
        for(b=7; b>-1; b--) {
            if((sr[ic]>>b)&1) output_high(SR_DS); else output_low(SR_DS);
            output_low(SR_SH); delay_us(1); output_high(SR_SH); delay_us(1);
        }
    }
    output_low(SR_ST); delay_us(1); output_high(SR_ST); delay_us(1);output_low(SR_ST);
}
void SR595_SetBit(uint8_t bit)             { sr[bit>>3] |=  (1<<(bit&7)); SR595_Latch(); }
void SR595_ClrBit(uint8_t bit)             { sr[bit>>3] &= ~(1<<(bit&7)); SR595_Latch(); }
void SR595_WriteByte(uint8_t ic,uint8_t v) { if(ic<3){ sr[ic]=v; SR595_Latch(); } }
void SR595_Clear(void)                     { sr[0]=sr[1]=sr[2]=0; SR595_Latch(); }
void Buzzer_Beep(uint8_t n)                { /* TODO */ }

/* --- DEBUG PRINT ----------------------------- */
void Debug_Print(void) {
    DI_Update();
    printf("BEGIN\\r\\n");
${inPrintLines || '    /* no DI */'}
${outPrintLines || '    /* no OUT */'}
${varPrintLines || '    /* no VAR */'}
    printf("END\\r\\n");
}

/* --- UART RX INTERRUPT ---------------------- */
#int_RDA
void UART_RX_isr(void) {
    static int idx = 0;
    char c = getc();
    if(c == '\\n' || c == '\\r') {
        rx_buf[idx] = '\\0';
        rx_idx = 1;
        idx = 0;
    } else if(idx < sizeof(rx_buf)-1) {
        rx_buf[idx++] = c;
    }
}

/* --- COMMAND HELPERS ------------------------ */
int my_atoi(char *s) {
    int val=0, sign=1;
    if(*s=='-'){ sign=-1; s++; }
    while(*s>='0' && *s<='9'){ val=val*10+(*s-'0'); s++; }
    return val*sign;
}

int parse_pin_index(char *name) {
${parsePinBody}
    return -1;
}

void process_cmd(char *cmd) {
    char *eq = strchr(cmd, '=');
    if(eq) {
        int idx, val;
        *eq = '\\0';
        idx = parse_pin_index(cmd);
        val = my_atoi(eq+1);
        if(idx >= 0) {
            if(val) SR595_SetBit((uint8_t)idx);
            else    SR595_ClrBit((uint8_t)idx);
            printf("OK %s=%d\\r\\n", cmd, val);
        } else {
            printf("ERR Unknown pin %s\\r\\n", cmd);
        }
    } else if(rx_buf[0]=='g') {
        giaotiep = 1;
    } else if(rx_buf[0]=='d') {
        giaotiep = 0; g_debug_tick = GetTick();
    } else if(rx_buf[0]=='m') {
        manual = 1;
        printf("MANUAL MODE\\r\\n");
    } else if(rx_buf[0]=='a') {
        manual = 0;
        printf("AUTO MODE\\r\\n");
    }
}

/* --- SUB-ROUTINES SOURCE CODE --------------- */
${functionsSourceCode}

/* --- TASK FUNCTIONS (auto-generated) -------- */
${taskFuncs || '/* No tasks defined */'}

/* --- COOPERATIVE SCHEDULER ------------------ */
void Scheduler_Run(void) {
    if(g_err) return;
${schedulerContent || '    /* no scheduler rules */'}
}

void main(void) {
    output_low(SR_ST);
    output_low(SR_SH);
    delay_ms(1000);
    output_high(SR_ST);
    output_high(SR_SH);
    setup_timer_2(T2_DIV_BY_16, 155, 2);
    enable_interrupts(INT_TIMER2);
    enable_interrupts(GLOBAL);
    DI_Update();
${eepromLoadCode ? eepromLoadCode : '    // Không có biến nào cần lưu EEPROM'}

/* --- INITIALIZE SERIAL LCD SCREEN --- */
    LCD_Initialize();
    LCD_Cmd(LCD_CLEAR); 
${doList.filter(d=>d.name).map(d=>`    ${d.init===1?`output_high(DO_${d.name})`:`output_low(DO_${d.name})`};`).join('\n')}
    SR595_Clear();
   
    enable_interrupts(INT_RDA);
    g_debug_tick = GetTick();

    while(TRUE) {
        if(manual == 0) {
            DI_Update();
            Scheduler_Run();
        }
        if(rx_idx) {
            process_cmd(rx_buf);
            rx_idx = 0;
        }
        if(giaotiep && Timeout(g_debug_tick, 500)) {
            g_debug_tick = GetTick();
            Debug_Print();
        }
    }
}
`;
}

export function hl(code) {
  let h = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return h;
}