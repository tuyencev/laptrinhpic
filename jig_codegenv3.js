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

function gc(block, tname) {
  const map = {
    b_task_begin: (b) => gStmt(b, 'S', tname),
    b_emit: (b) => `    EVT_Emit(${b.getFieldValue('EV')});\n`,
    b_wait_all: (b) => {
      return `    case ${tname}_S${sn}:\n        if(!EVT_HasAll(${b.getFieldValue('EVS')})) break;\n        EVT_Clear(${b.getFieldValue('EVS')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
   b_wait_any: (b) => {

  let evs = b.getFieldValue('EVS')
              .split(',')
              .join(' | ');

  return `
    case ${tname}_S${sn}:
        if(!EVT_HasAny(${evs})) break;
        ${tname}_state=${tname}_S${++sn};
        break;
`;
},
    b_task_done: () => `    ${tname}_state=${tname}_DONE;\n    break;\n`,
    b_task_restart: () => `    ${tname}_state=${tname}_S0;\n    break;\n`,
    b_delay: (b) => `    case ${tname}_S${sn}:\n        if(Delay_NB(&${tname}_dly, ${b.getFieldValue('MS')})){\n            ${tname}_state = ${tname}_S${++sn};\n        }\n        break;\n`,
    
    b_loop_n: (b) => {
      const n = b.getFieldValue('N') || '1';
      const loopIdx = sn; 
      const startState = `${tname}_S${loopIdx}`;
      
      let out = `    case ${startState}:\n        ${tname}_loop_${loopIdx} = 0;\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
      
      const bodyStateIdx = sn;
      const bodyCode = gStmt(b, 'DO', tname);
      out += bodyCode;
      
      out += `    case ${tname}_S${sn}:\n        ${tname}_loop_${loopIdx}++;\n        if(${tname}_loop_${loopIdx} < ${n}){\n            ${tname}_state=${tname}_S${bodyStateIdx};\n        } else {\n            ${tname}_state=${tname}_S${++sn};\n        }\n        break;\n`;
      return out;
    },
    
    b_loop_while: (b) => `    while(DI_Get(IDX_${b.getFieldValue('DI')})==${b.getFieldValue('V')}){\n${gStmt(b, 'DO', tname)}\n    }\n`,
    b_wait_di_on: (b) => `    case ${tname}_S${sn}:\n        if(DI_Get(IDX_${b.getFieldValue('DI')})) ${tname}_state=${tname}_S${++sn};\n        break;\n`,
    b_wait_di_off: (b) => `    case ${tname}_S${sn}:\n        if(!DI_Get(IDX_${b.getFieldValue('DI')})) ${tname}_state=${tname}_S${++sn};\n        break;\n`,
    b_if_multi: (b) => {
      // State machine-safe if/else: flatten into branch states, no case labels inside if/else braces
      const condState = sn;
      sn++; // S(condState) = decision state; body starts at sn
      const thenStartSn = sn;
      const thenCode = gStmt(b, 'DO', tname);
      const thenEndSn = sn;
      sn++; // jump-over state index (allocated for the then→merge jump)
      const elseStartSn = sn;
      const elseCode = gStmt(b, 'ELSE', tname);
      const mergeState = sn; // first state after the whole if/else
      return (
        `    case ${tname}_S${condState}:\n` +
        `        if(${buildMultiCond(b)}) ${tname}_state=${tname}_S${thenStartSn};\n` +
        `        else ${tname}_state=${tname}_S${elseStartSn};\n` +
        `        break;\n` +
        thenCode +
        `    case ${tname}_S${thenEndSn}:\n` +
        `        ${tname}_state=${tname}_S${mergeState};\n` +
        `        break;\n` +
        elseCode
      );
    },
    
    // Thêm Nhãn Case cho các lệnh điều khiển Output để không bị gộp dòng vô lý
    b_do_set: (b) => `    case ${tname}_S${sn}:\n        ${outMacro('DO:' + b.getFieldValue('DO'))};\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`,
    b_do_clr: (b) => `    case ${tname}_S${sn}:\n        ${outMacroClear('DO:' + b.getFieldValue('DO'))};\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`,
    b_do_tog: (b) => `    case ${tname}_S${sn}:\n        output_toggle(DO_${b.getFieldValue('DO')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`,
    b_do_pulse: (b) => `    case ${tname}_S${sn}:\n        output_high(DO_${b.getFieldValue('DO')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`,
    b_sr_set: (b) => `    case ${tname}_S${sn}:\n        SR595_SetBit(B595_${b.getFieldValue('B').replace(/[^a-z0-9_]/gi, '_')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`,
    b_sr_clr: (b) => `    case ${tname}_S${sn}:\n        SR595_ClrBit(B595_${b.getFieldValue('B').replace(/[^a-z0-9_]/gi, '_')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`,
    b_sr_pulse: (b) => `    case ${tname}_S${sn}:\n        SR595_SetBit(B595_${b.getFieldValue('B').replace(/[^a-z0-9_]/gi, '_')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`,
    b_sr_byte: (b) => `    case ${tname}_S${sn}:\n        SR595_WriteByte(${b.getFieldValue('IC')},0x${b.getFieldValue('V')});\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`,
    
    b_cyl_ext: (b) => {
      const c = cylList.find((x) => x.name === b.getFieldValue('C')) || {};
      return `    /* ${b.getFieldValue('C')} EXT */\n    case ${tname}_S${sn}:\n        ${outMacro(c.out_ext)}; ${outMacroClear(c.out_ret)};\n        if(DI_Get(IDX_${c.sen_ext || 'NONE'})||Timeout(${tname}_t0,${c.timeout || 4000})){\n            ${outMacroClear(c.out_ext)}; ${tname}_state=${tname}_S${++sn};\n        }\n        break;\n`;
    },
    b_cyl_ret: (b) => {
      const c = cylList.find((x) => x.name === b.getFieldValue('C')) || {};
      return `    /* ${b.getFieldValue('C')} RET */\n    case ${tname}_S${sn}:\n        ${outMacro(c.out_ret)}; ${outMacroClear(c.out_ext)};\n        if(DI_Get(IDX_${c.sen_ret || 'NONE'})||Timeout(${tname}_t0,${c.timeout || 4000})){\n            ${outMacroClear(c.out_ret)}; ${tname}_state=${tname}_S${++sn};\n        }\n        break;\n`;
    },
    b_cyl_wait_ext: (b) => {
      const c = cylList.find((x) => x.name === b.getFieldValue('C')) || {};
      return `    case ${tname}_S${sn}:\n        if(DI_Get(IDX_${c.sen_ext || 'NONE'})) ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_cyl_wait_ret: (b) => {
      const c = cylList.find((x) => x.name === b.getFieldValue('C')) || {};
      return `    case ${tname}_S${sn}:\n        if(DI_Get(IDX_${c.sen_ret || 'NONE'})) ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_mot_run_sen: (b) => {
      const m = motList.find((x) => x.name === b.getFieldValue('M')) || {};
      const dir = b.getFieldValue('D');
      const sen = dir === 'FWD' ? m.sen_fwd : m.sen_rev;
      return `    /* ${b.getFieldValue('M')} ${dir} to sensor */\n    case ${tname}_S${sn}:\n        ${outMacro(m.out_en)};\n        if(${dir === 'FWD' ? `output_high(DO_${m.out_dir.slice(3)})` : `output_low(DO_${m.out_dir.slice(3)})`});\n        if(DI_Get(IDX_${sen || 'NONE'})||Timeout(${tname}_t0,${m.timeout || 5000})){\n            ${outMacroClear(m.out_en)}; ${tname}_state=${tname}_S${++sn};\n        }\n        break;\n`;
    },
    b_mot_run_time: (b) => {
      const m = motList.find((x) => x.name === b.getFieldValue('M')) || {};
      const dir = b.getFieldValue('D');
      return `    case ${tname}_S${sn}:\n        ${outMacro(m.out_en)}; if(${dir === 'FWD' ? `output_high(DO_${m.out_dir.slice(3)})` : `output_low(DO_${m.out_dir.slice(3)})`});\n        if(Timeout(${tname}_t0,${b.getFieldValue('T')})){${outMacroClear(m.out_en)}; ${tname}_state=${tname}_S${++sn};}\n        break;\n`;
    },
    b_mot_stop: (b) => {
      const m = motList.find((x) => x.name === b.getFieldValue('M')) || {};
      return `    case ${tname}_S${sn}:\n        ${outMacroClear(m.out_en)};\n        ${tname}_state=${tname}_S${++sn};\n        break;\n`;
    },
    b_mot_wait: () => `    /* wait motor done */\n`,
    b_var_set: (b) => `    ${b.getFieldValue('V')}=${b.getFieldValue('VAL')};\n`,
    b_var_inc: (b) => `    ${b.getFieldValue('V')}++;\n`,
    b_var_dec: (b) => `    ${b.getFieldValue('V')}--;\n`,
    b_if_var: (b) => {
      const condState = sn;
      sn++;
      const thenStartSn = sn;
      const thenCode = gStmt(b, 'DO', tname);
      const thenEndSn = sn;
      sn++;
      const elseStartSn = sn;
      const elseCode = gStmt(b, 'ELSE', tname);
      const mergeState = sn;
      return (
        `    case ${tname}_S${condState}:\n` +
        `        if(${b.getFieldValue('V')}${b.getFieldValue('OP')}${b.getFieldValue('VAL')}) ${tname}_state=${tname}_S${thenStartSn};\n` +
        `        else ${tname}_state=${tname}_S${elseStartSn};\n` +
        `        break;\n` +
        thenCode +
        `    case ${tname}_S${thenEndSn}:\n` +
        `        ${tname}_state=${tname}_S${mergeState};\n` +
        `        break;\n` +
        elseCode
      );
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

// THUẬT TOÁN SỬA ĐỔI: Gom chuẩn xác tất cả State dựa trên cả nhãn hiển thị và lệnh gán nhảy trạng thái
function getStateList(body, tname) {
  const numbers = new Set();
  
  // Quét các chuỗi dạng "case tên_task_SX:"
  const casePattern = new RegExp(`case ${tname}_S(\\d+):`, 'g');
  for (const match of body.matchAll(casePattern)) {
    numbers.add(parseInt(match[1], 10));
  }
  
  // Quét các chuỗi dạng "tên_task_state=tên_task_SX;" hoặc "=SX;"
  const assignPattern = new RegExp(`${tname}_state\\s*=\\s*(?:${tname}_)?S(\\d+)`, 'g');
  for (const match of body.matchAll(assignPattern)) {
    numbers.add(parseInt(match[1], 10));
  }
  
  // Sắp xếp các state tăng dần từ S1, S2... Loại bỏ S0 vì đã khai báo mặc định ở đầu enum
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
  const ds = document.getElementById('p-ds').value || 'PIN_C5';
  const sh = document.getElementById('p-sh').value || 'PIN_C6';
  const st = document.getElementById('p-st').value || 'PIN_C7';
  const ws = window.workspace || workspace;
  const tops = ws ? ws.getTopBlocks(true).filter((b) => b.type === 'b_task_begin') : [];

  const formatCcsPin = (p) => {
    if (!p) return 'PIN_A0';
    if (p.toUpperCase().startsWith('PIN_')) return p.toUpperCase();
    return `PIN_${p.toUpperCase().slice(-2)}`;
  };

  const allEvts = collectEvents();
  
  const doDefs = doList.filter((d) => d.name).map((d) => `#define DO_${d.name} ${formatCcsPin(d.pin)}`).join('\n');
  const diPinDefs = diList.filter((d) => d.name).map((d) => `#define DI_${d.name} ${formatCcsPin(d.pin)}`).join('\n');
  const diIdxDefs = diList.filter((d) => d.name).map((d, i) => `#define IDX_${d.name} ${i}`).join('\n');
  const srDefs = bits595.map((b, i) => `#define B595_${b.name.replace(/[^a-z0-9_]/gi, '_')} ${i}`).join('\n');
  
  const varDefs = varList.filter((v) => v.name).map((v) => {
    let type = v.type;
    if(type === 'uint8_t' || type === 'unsigned int8') type = 'int8';
    if(type === 'uint16_t' || type === 'unsigned int16') type = 'int16';
    if(type === 'uint32_t' || type === 'unsigned int32') type = 'int32';
    return `${type} ${v.name}=${v.init || 0};`;
  }).join('\n');

  const evtDefs = allEvts.map((e, i) => `#define ${e} (1UL<<${i})`).join('\n');
  const diFiltered  = diList.filter((d) => d.name);
  const srFiltered  = bits595.filter((b) => b.name);
  const varFiltered = varList.filter((v) => v.name);

  const diNames  = diFiltered.map((d) => `"${d.name.replace(/"/g, '\\"')}"`).join(', ');
  const srNames  = bits595.map((b, i) => `"${(b.name || `Q${i}`).replace(/"/g, '\\"')}"`).join(', ');
  const varNames = varFiltered.map((v) => `"${v.name.replace(/"/g, '\\"')}"`).join(', ');

  const diCount  = diFiltered.length;
  const srCount  = bits595.length;
  const varCount = varFiltered.length;

  // Generate per-IN print lines:  printf("IN %s = %s\r\n", pin_in_Names[j], logic_level[state])
  const inPrintLines = diFiltered
    .map((_, i) => `    printf("IN %s = %s\\r\\n", pin_in_Names[${i}], DI_Get(${i}) ? "1" : "0");`)
    .join('\n');

  // Generate per-OUT print lines: printf("OUT %s=%u\r\n", outputNames[a], data595[a])
  const outPrintLines = bits595
    .map((_, i) => `    printf("OUT %s=%u\\r\\n", outputNames[${i}], (sr[${i}>>3]>>(${i}&7))&1);`)
    .join('\n');

  // Generate per-VAR print lines
  const varPrintLines = varFiltered
    .map((v, i) => `    printf("VAR %s=%ld\\r\\n", varNames[${i}], (long)${v.name});`)
    .join('\n');

  // Name arrays for debug (only emitted when there's at least one entry)
  const debugNameArrays = [
    diCount  > 0 ? `const char* pin_in_Names[${diCount}]  = { ${diNames} };`  : '',
    srCount  > 0 ? `const char* outputNames[${srCount}]   = { ${srNames} };`  : '',
    varCount > 0 ? `const char* varNames[${varCount}]     = { ${varNames} };` : '',
  ].filter(Boolean).join('\n');

  // Full Debug_Print function body
  const debugFn = `void Debug_Print(void) {\n    printf("BEGIN\\r\\n");\n${inPrintLines || '    /* no DI */'}\n${outPrintLines || '    /* no OUT */'}\n${varPrintLines || '    /* no VAR */'}\n    printf("END\\r\\n");\n}`;

  const taskFuncs = tops
    .map((b) => {
      sn = 0;
      const tn = b.getFieldValue('TK');
      const body = gStmt(b, 'S', tn);
      const states = getStateList(body, tn).join(', ');
      const loopVars = getLoopVars(body, tn);
      
      return `/* ─── TASK: ${tn} ─────────────────────── */\ntypedef enum { ${tn}_S0${states ? `, ${states}` : ''} , ${tn}_DONE, ${tn}_ERR } ${tn}_St;\n${tn}_St ${tn}_state = ${tn}_S0;\nuint32_t ${tn}_t0 = 0;\nDelayNB_t ${tn}_dly;\n${loopVars || ''}\n\nvoid Task_${tn}(void) {\n    if(g_err) return;\n    switch(${tn}_state) {\n${body.split('\n').map((l) => (l ? `        ${l}` : l)).join('\n')}\n        case ${tn}_DONE: break;\n        case ${tn}_ERR:  g_err=1; break;\n        default: break;\n    }\n}`;
    })
    .join('\n\n');

  return `/*************************************************************\n * JIGSIM v4 — Cooperative Multi-Task Scheduler (CCS Compiler)\n *************************************************************/\n#include <18F4520.h>\n#use delay(crystal=20000000)
#use rs232(baud=115200, xmit=PIN_C6, rcv=PIN_C7)\n\ntypedef int8 uint8_t;\ntypedef int16 uint16_t;\ntypedef int32 uint32_t;\n\n/* ─── OUTPUT HARDWARE PINS ─────────────────── */\n${doDefs || '/* none */'}\n\n/* ─── INPUT HARDWARE PINS ──────────────────── */\n${diPinDefs || '/* none */'}\n\n/* ─── INPUT DEBOUNCE INDEX ─────────────────── */\n${diIdxDefs || '/* none */'}\n\n/* ─── 595 BIT NAMES ────────────────────────── */\n${srDefs}\n\n/* ─── EVENT FLAGS ──────────────────────────── */\n${evtDefs || '/* no events */'}\nuint32_t g_evt = 0;\nvoid EVT_Emit(uint32_t mask)    { g_evt |=  mask; }\nvoid EVT_Clear(uint32_t mask)   { g_evt &= ~mask; }\nuint8_t EVT_HasAll(uint32_t m)  { return (g_evt & m)==m; }\nuint8_t EVT_HasAny(uint32_t m)  { return (g_evt & m)!=0; }\n\n/* ─── USER VARIABLES ───────────────────────── */\n${varDefs || '/* none */'}\nuint8_t g_err = 0;\n\n/* ══════════════════════════════════════════════\n   TICK TIMER — 1ms interrupt bằng TIMER2\n══════════════════════════════════════════════ */\nvolatile uint32_t g_tick=0;\n#int_TIMER2\nvoid TIMER2_isr(void){\n    g_tick++;\n}\nuint32_t GetTick(void){return g_tick;}\nuint8_t  Timeout(uint32_t s,uint32_t d){return(GetTick()-s)>=d;}\n\ntypedef struct{\n    uint32_t t;\n    uint8_t a;\n} DelayNB_t;\n\nuint8_t Delay_NB(DelayNB_t* d, uint32_t ms){\n    if(!d->a){\n        d->t=GetTick();\n        d->a=1;\n        return 0;\n    }\n    if(Timeout(d->t,ms)){\n        d->a=0;\n        return 1;\n    }\n    return 0;\n}\nvoid Delay_NB_Reset(DelayNB_t* d){\n    d->a=0;\n}\n\n/* ══════════════════════════════════════════════\n   DEBOUNCE INPUT\n══════════════════════════════════════════════ */\n#define DI_N (2+${diList.length})\ntypedef struct{\n    uint8_t r;\n    uint8_t s;\n    uint8_t p;\n    uint32_t lc;\n} DI_t;\n\nDI_t di[DI_N];\n\nvoid DI_Update(void){\n    uint8_t i;\n ${diList.filter((d) => d.name).map((d) => `    di[${diList.indexOf(d) }].r = ${d.active === 'LOW' ? `!input(DI_${d.name})` : `input(DI_${d.name})`};`).join('\n') || ''}\n    for(i=0;i<DI_N;i++){\n        if(di[i].r!=di[i].s){if(Timeout(di[i].lc,20)){di[i].p=di[i].s;di[i].s=di[i].r;}}\n        else di[i].lc=GetTick();\n    }\n}\nuint8_t DI_Get(uint8_t i){return i<DI_N?di[i].s:0;}\nuint8_t DI_Rise(uint8_t i){if(i<DI_N&&di[i].s&&!di[i].p){di[i].p=1;return 1;}return 0;}\n\n/* ══════════════════════════════════════════════\n   74HC595 — 3IC daisy-chain bit-bang\n══════════════════════════════════════════════ */\n#define SR_DS  ${formatCcsPin(ds)}\n#define SR_SH  ${formatCcsPin(sh)}\n#define SR_ST  ${formatCcsPin(st)}\nuint8_t sr[3]={0,0,0};\nvoid SR595_Latch(void){\n    signed int8 ic,b;\n    output_low(SR_ST);\n    for(ic=2;ic>-1;ic--)\n    {  \n  for(b=7;b>-1;b--){\n            if((sr[ic]>>b)&1) output_high(SR_DS); else output_low(SR_DS);\n            output_low(SR_SH); delay_us(1);output_high(SR_SH);\n  delay_us(1);      }\n }\n   output_low(SR_ST); delay_us(1);output_high(SR_ST);delay_us(1);\n}\nvoid SR595_SetBit(uint8_t bit){sr[bit>>3]|= (1<<(bit&7)); SR595_Latch();}\nvoid SR595_ClrBit(uint8_t bit){sr[bit>>3]&=~(1<<(bit&7)); SR595_Latch();}\nvoid SR595_WriteByte(uint8_t ic,uint8_t v){if(ic<3){sr[ic]=v;SR595_Latch();}}\nvoid SR595_Clear(void){sr[0]=sr[1]=sr[2]=0;SR595_Latch();}\n\nvoid Buzzer_Beep(uint8_t n){/* TODO */}\n\n/* ══════════════════════════════════════════════\n   TASK FUNCTIONS (auto-generated)\n══════════════════════════════════════════════ */\n${taskFuncs || '/* No tasks defined */'}\n\n/* ══════════════════════════════════════════════\n   COOPERATIVE SCHEDULER\n══════════════════════════════════════════════ */\nvoid Scheduler_Run(void){\n  if(g_err){\n        return;\n    }\n${tops.map((b) => `    Task_${b.getFieldValue('TK')}();`).join('\n') || '    /* no tasks */'}\n}\n\nvoid main(void){\n    uint8_t i;\n    setup_timer_2(T2_DIV_BY_16, 155, 2);\n    enable_interrupts(INT_TIMER2);\n    enable_interrupts(GLOBAL);\n\n output_low(SR_ST); \n output_low(SR_SR_SH);\ndelay_ms(1000);\noutput_high(SR_ST);\noutput_high(SR_SH); \n ${doList.map((d) => `    ${d.init || 0 === 1 ? `output_high(DO_${d.name})` : `output_low(DO_${d.name})`};`).join('\n') || ''}\n    SR595_Clear();\n\n    for(i=0;i<DI_N;i++){di[i].r=di[i].s=di[i].p=0;di[i].lc=0;}\n    while(TRUE){\n        DI_Update();\n        Scheduler_Run();\n    }\n}\n`;
}

export function hl(code) {
  let h = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return h;
}