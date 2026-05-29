import { diList, doList, cylList, motList, varList, bits595, workspace } from './jig_data.js';

export let simRunning = false;
let simStart = 0;
let evtBus = 0n;
let eventMap = {};
let simDO = {};
let simSR = new Array(24).fill(0);
let simDI = {};
let simVAR = {};
let taskStates = {};
let waitingBtns = [];

function evtBit(name) {
  if (!(name in eventMap)) {
    eventMap[name] = Object.keys(eventMap).length;
  }
  return 1n << BigInt(eventMap[name]);
}

function emitEvt(name) {
  evtBus |= evtBit(name);
  simLog(`📡 EMIT ${name}`, 'ls', null);
}

function clearEvt(name) {
  evtBus &= ~evtBit(name);
}

function hasEvt(name) {
  return (evtBus & evtBit(name)) !== 0n;
}

function hasAllEvts(names) {
  return names.every((n) => hasEvt(n));
}

function hasAnyEvt(names) {
  return names.some((n) => hasEvt(n));
}

export function simLog(msg, cls = 'li', taskName) {
  const el = document.getElementById('sim-log');
  const t = simRunning ? ((Date.now() - simStart) / 1000).toFixed(2) : '0.00';
  const tk = taskName ? `[${taskName}]` : '[sys]';
  el.innerHTML += `<div class="le"><span class="lt">${t}s</span><span class="ltk">${tk}</span><span class="${cls}">${msg}</span></div>`;
  el.scrollTop = el.scrollHeight;
}

export function clearLog() {
  document.getElementById('sim-log').innerHTML = '';
}

export function setTaskState(name, state) {
  taskStates[name] = state;
  const dot = document.getElementById(`tm-dot-${name}`);
  const st = document.getElementById(`tm-st-${name}`);
  if (dot) dot.className = 'tm-dot ' + state;
  if (st) st.textContent = state.toUpperCase();
}

export function writeDO(name, val) {
  if (name.startsWith('SR:')) {
    const bname = name.slice(3);
    const idx = bits595.findIndex((b) => b.name === bname);
    if (idx >= 0) {
      simSR[idx] = val;
      updateSimDisplay();
    }
  } else if (name.startsWith('DO:')) {
    const dname = name.slice(3);
    simDO[dname] = val;
    updateSimDisplay();
  } else {
    simDO[name] = val;
    updateSimDisplay();
  }
}

export function toggleSimInput(name) {
  simDI[name] = simDI[name] ? 0 : 1;
  updateSimDisplay();
  simLog(`🖱 ${name} ${simDI[name] ? 'ON' : 'OFF'}`, 'ls', null);
  const el = document.getElementById(`sdi-${name}`);
  if (el) el.classList.toggle('active', !!simDI[name]);
}

function readDI(name) {
  return simDI[name] || 0;
}

function multiCond(block) {
  const count = block.conditionCount_ || 2;
  let result = false;
  for (let i = 0; i < count; i += 1) {
    const src = block.getFieldValue(`F${i + 1}`) || 'DI:NONE';
    const cmp = block.getFieldValue(`CMP${i + 1}`) || '==';
    const val = +block.getFieldValue(`V${i + 1}`);
    let current = false;
    if (src.startsWith('DI:')) {
      current = compare(readDI(src.slice(3)), cmp, val);
    } else if (src.startsWith('VAR:')) {
      const name = src.slice(4);
      current = compare(simVAR[name] || 0, cmp, val);
    }
    if (i === 0) {
      result = current;
    } else {
      const op = block.getFieldValue(`LOGIC${i}`) || 'AND';
      result = op === 'AND' ? result && current : result || current;
    }
  }
  return result;
}

function compare(left, cmp, right) {
  switch (cmp) {
    case '!=':
      return left !== right;
    case '>=':
      return left >= right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '<':
      return left < right;
    default:
      return left === right;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    const end = Date.now() + ms;
    function tick() {
      if (!simRunning || Date.now() >= end) resolve();
      else setTimeout(tick, 10);
    }
    tick();
  });
}

function waitDIOn(name) {
  return new Promise((resolve) => {
    function tick() {
      if (!simRunning || readDI(name)) resolve();
      else setTimeout(tick, 20);
    }
    tick();
  });
}

function waitDIOff(name) {
  return new Promise((resolve) => {
    function tick() {
      if (!simRunning || !readDI(name)) resolve();
      else setTimeout(tick, 20);
    }
    tick();
  });
}

function waitAllEvents(names) {
  return new Promise((resolve) => {
    function tick() {
      if (!simRunning || hasAllEvts(names)) resolve();
      else setTimeout(tick, 20);
    }
    tick();
  });
}

function waitAnyEvent(names) {
  return new Promise((resolve) => {
    function tick() {
      if (!simRunning || hasAnyEvt(names)) resolve();
      else setTimeout(tick, 20);
    }
    tick();
  });
}

function waitBtn(btn) {
  return new Promise((resolve) => {
    waitingBtns.push({ btn, resolve });
  });
}

function runCylAction(block, taskName, action) {
  const cn = block.getFieldValue('C');
  const cd = cylList.find((c) => c.name === cn);
  if (!cd) return Promise.resolve();
  const output = action === 'EXT' ? cd.out_ext : cd.out_ret;
  const opposite = action === 'EXT' ? cd.out_ret : cd.out_ext;
  const sensor = action === 'EXT' ? cd.sen_ext : cd.sen_ret;
  const otherSensor = action === 'EXT' ? cd.sen_ret : cd.sen_ext;
  simLog(`${action === 'EXT' ? '🔼' : '🔽'} ${cn} ${action} → ${output}`, 'li', taskName);
  writeDO(output, 1);
  return sleep(50).then(() => {
    writeDO(opposite || '', 0);
    return sleep(600);
  }).then(() => {
    if (sensor && sensor !== 'NONE') simDI[sensor] = 1;
    if (otherSensor && otherSensor !== 'NONE') simDI[otherSensor] = 0;
    writeDO(output, 0);
    updateSimDisplay();
    simLog(`✓ ${cn} ${action} done`, 'lok', taskName);
  });
}

function runMotAction(block, taskName) {
  const mn = block.getFieldValue('M');
  const md = motList.find((m) => m.name === mn);
  if (!md) return Promise.resolve();
  const direction = block.getFieldValue('D');
  if (block.type === 'b_mot_run_sen') {
    const sensorKey = direction === 'FWD' ? md.sen_fwd : md.sen_rev;
    simLog(`▶ ${mn} ${direction} → sensor`, 'li', taskName);
    writeDO(md.out_en, 1);
    if (md.out_dir) writeDO(md.out_dir, direction === 'FWD' ? 1 : 0);
    return sleep(1200).then(() => {
      if (sensorKey && sensorKey !== 'NONE') simDI[sensorKey] = 1;
      writeDO(md.out_en, 0);
      updateSimDisplay();
      simLog(`✓ ${mn} reached sensor`, 'lok', taskName);
    });
  }
  if (block.type === 'b_mot_run_time') {
    const ms = +block.getFieldValue('T');
    simLog(`▶ ${mn} ${direction} ${ms}ms`, 'li', taskName);
    writeDO(md.out_en, 1);
    if (md.out_dir) writeDO(md.out_dir, direction === 'FWD' ? 1 : 0);
    return sleep(ms).then(() => {
      writeDO(md.out_en, 0);
      updateSimDisplay();
      simLog(`✓ ${mn} done`, 'lok', taskName);
    });
  }
  if (block.type === 'b_mot_stop') {
    writeDO(md.out_en, 0);
    simLog(`■ ${mn} stop`, 'lw', taskName);
    return Promise.resolve();
  }
  if (block.type === 'b_mot_wait') {
    simLog(`⏳ Chờ ${mn} done`, 'li', taskName);
    return sleep(50);
  }
  return Promise.resolve();
}

function runDOAction(block, taskName) {
  const name = block.getFieldValue('DO');
  switch (block.type) {
    case 'b_do_set':
      writeDO('DO:' + name, 1);
      simLog(`🟢 SET ${name}`, 'lok', taskName);
      break;
    case 'b_do_clr':
      writeDO('DO:' + name, 0);
      simLog(`⚫ CLR ${name}`, 'li', taskName);
      break;
    case 'b_do_tog': {
      const nv = (simDO[name] || 0) ^ 1;
      writeDO('DO:' + name, nv);
      simLog(`🔃 TOG ${name}→${nv}`, 'li', taskName);
      break;
    }
    case 'b_do_pulse': {
      const ms = +block.getFieldValue('MS');
      writeDO('DO:' + name, 1);
      simLog(`🔔 PULSE ${name} ${ms}ms`, 'lok', taskName);
      return sleep(ms).then(() => writeDO('DO:' + name, 0));
    }
  }
  return Promise.resolve();
}

function runSRAction(block, taskName) {
  const nm = block.getFieldValue('B');
  const idx = bits595.findIndex((b) => b.name === nm);
  switch (block.type) {
    case 'b_sr_set':
      if (idx >= 0) simSR[idx] = 1;
      updateSimDisplay();
      simLog(`🟣 SR SET ${nm}`, 'ls', taskName);
      break;
    case 'b_sr_clr':
      if (idx >= 0) simSR[idx] = 0;
      updateSimDisplay();
      simLog(`⚪ SR CLR ${nm}`, 'li', taskName);
      break;
    case 'b_sr_pulse': {
      const ms = +block.getFieldValue('MS');
      if (idx >= 0) simSR[idx] = 1;
      updateSimDisplay();
      simLog(`⚡ SR PULSE ${nm} ${ms}ms`, 'ls', taskName);
      return sleep(ms).then(() => {
        if (idx >= 0) simSR[idx] = 0;
        updateSimDisplay();
      });
    }
    case 'b_sr_byte': {
      const ic = +block.getFieldValue('IC');
      const val = parseInt(block.getFieldValue('V'), 16);
      for (let b = 0; b < 8; b += 1) simSR[ic * 8 + b] = (val >> b) & 1;
      updateSimDisplay();
      simLog(`📝 SR IC${ic + 1}=0x${block.getFieldValue('V')}`, 'ls', taskName);
      break;
    }
  }
  return Promise.resolve();
}

function runCondAction(block, taskName) {
  const result = multiCond(block);
  simLog(`❓ cond → ${result ? 'TRUE' : 'FALSE'}`, 'li', taskName);
  const branch = result ? 'DO' : 'ELSE';
  return execStmts(block, branch, taskName);
}

function runVarAction(block, taskName) {
  const name = block.getFieldValue('V');
  switch (block.type) {
    case 'b_var_set':
      simVAR[name] = parseInt(block.getFieldValue('VAL'));
      updateSimDisplay();
      simLog(`𝑥 ${name}=${block.getFieldValue('VAL')}`, 'lw', taskName);
      break;
    case 'b_var_inc':
      simVAR[name] = (simVAR[name] || 0) + 1;
      updateSimDisplay();
      simLog(`𝑥 ${name}++`, 'lw', taskName);
      break;
    case 'b_var_dec':
      simVAR[name] = (simVAR[name] || 0) - 1;
      updateSimDisplay();
      simLog(`𝑥 ${name}--`, 'lw', taskName);
      break;
    case 'b_if_var': {
      const val = parseInt(block.getFieldValue('VAL'));
      const op = block.getFieldValue('OP');
      const cur = simVAR[name] || 0;
      const res = eval(`${cur}${op}${val}`);
      simLog(`❓ ${name}(${cur})${op}${val}→${res ? 'T' : 'F'}`, 'lw', taskName);
      if (res) return execStmts(block, 'DO', taskName);
      return execStmts(block, 'ELSE', taskName);
    }
  }
  return Promise.resolve();
}

function execBlock(block, taskName) {
  if (!block || !simRunning) return Promise.resolve();
  switch (block.type) {
    case 'b_task_begin':
      return execStmts(block, 'S', taskName);
    case 'b_emit':
      emitEvt(block.getFieldValue('EV'));
      return Promise.resolve();
    case 'b_wait_all': {
      const evs = block.getFieldValue('EVS').split(',').map((e) => e.trim());
      setTaskState(taskName, 'wait');
      simLog(`⏳ WAIT ALL: ${evs.join(', ')}`, 'ls', taskName);
      return waitAllEvents(evs).then(() => {
        setTaskState(taskName, 'run');
        evs.forEach(clearEvt);
      });
    }
    case 'b_wait_any': {
      const evs = block.getFieldValue('EVS').split(',').map((e) => e.trim());
      setTaskState(taskName, 'wait');
      simLog(`⏳ WAIT ANY: ${evs.join(', ')}`, 'ls', taskName);
      return waitAnyEvent(evs).then(() => setTaskState(taskName, 'run'));
    }
    case 'b_wait_task_done': {
      const tgt = block.getFieldValue('TK');
      const evt = `${tgt}_DONE`;
      setTaskState(taskName, 'wait');
      simLog(`⏳ WAIT TASK ${tgt} DONE`, 'ls', taskName);
      return waitAnyEvent([evt]).then(() => setTaskState(taskName, 'run'));
    }
    case 'b_task_done':
      emitEvt(`${taskName}_DONE`);
      setTaskState(taskName, 'done');
      simLog('✅ Task kết thúc', 'lok', taskName);
      return Promise.resolve();
    case 'b_task_restart':
      simLog('↺ Restart', 'lw', taskName);
      return Promise.resolve();
    case 'b_delay':
      simLog(`⏱ ${+block.getFieldValue('MS')}ms`, 'li', taskName);
      return sleep(+block.getFieldValue('MS'));
    case 'b_loop_n':
      return new Promise(async (resolve) => {
        const n = +block.getFieldValue('N');
        for (let i = 0; i < n && simRunning; i += 1) {
          simLog(`🔁 ${i + 1}/${n}`, 'li', taskName);
          await execStmts(block, 'DO', taskName);
        }
        resolve();
      });
    case 'b_loop_while': {
      const di = block.getFieldValue('DI');
      const v = +block.getFieldValue('V');
      return new Promise(async (resolve) => {
        while (readDI(di) === v && simRunning) {
          await execStmts(block, 'DO', taskName);
          await sleep(30);
        }
        resolve();
      });
    }
    case 'b_wait_di_on':
      setTaskState(taskName, 'wait');
      simLog(`⏳ Chờ ${block.getFieldValue('DI')} ON`, 'li', taskName);
      return waitDIOn(block.getFieldValue('DI')).then(() => setTaskState(taskName, 'run'));
    case 'b_wait_di_off':
      setTaskState(taskName, 'wait');
      simLog(`⏳ Chờ ${block.getFieldValue('DI')} OFF`, 'li', taskName);
      return waitDIOff(block.getFieldValue('DI')).then(() => setTaskState(taskName, 'run'));
    case 'b_if_multi':
      return runCondAction(block, taskName);
    case 'b_do_set':
    case 'b_do_clr':
    case 'b_do_tog':
    case 'b_do_pulse':
      return runDOAction(block, taskName);
    case 'b_sr_set':
    case 'b_sr_clr':
    case 'b_sr_pulse':
    case 'b_sr_byte':
      return runSRAction(block, taskName);
    case 'b_cyl_ext':
      return runCylAction(block, taskName, 'EXT');
    case 'b_cyl_ret':
      return runCylAction(block, taskName, 'RET');
    case 'b_cyl_wait_ext':
      return new Promise((resolve) => {
        const cd = cylList.find((c) => c.name === block.getFieldValue('C'));
        if (cd && cd.sen_ext && cd.sen_ext !== 'NONE') {
          setTaskState(taskName, 'wait');
          simLog(`⏳ Chờ ${block.getFieldValue('C')} sensor EXT`, 'li', taskName);
          waitDIOn(cd.sen_ext).then(() => {
            setTaskState(taskName, 'run');
            resolve();
          });
        } else resolve();
      });
    case 'b_cyl_wait_ret':
      return new Promise((resolve) => {
        const cd = cylList.find((c) => c.name === block.getFieldValue('C'));
        if (cd && cd.sen_ret && cd.sen_ret !== 'NONE') {
          setTaskState(taskName, 'wait');
          simLog(`⏳ Chờ ${block.getFieldValue('C')} sensor RET`, 'li', taskName);
          waitDIOn(cd.sen_ret).then(() => {
            setTaskState(taskName, 'run');
            resolve();
          });
        } else resolve();
      });
    case 'b_mot_run_sen':
    case 'b_mot_run_time':
    case 'b_mot_stop':
    case 'b_mot_wait':
      return runMotAction(block, taskName);
    case 'b_var_set':
    case 'b_var_inc':
    case 'b_var_dec':
    case 'b_if_var':
      return runVarAction(block, taskName);
    case 'b_err':
      simLog('🛑 ERR STOP', 'ler', taskName);
      setTaskState(taskName, 'err');
      stopSim();
      return Promise.resolve();
    case 'b_pass':
      simLog('✅ PASS', 'lok', taskName);
      return Promise.resolve();
    case 'b_fail':
      simLog('❌ FAIL', 'ler', taskName);
      return Promise.resolve();
    case 'b_buzzer':
      return sleep(+block.getFieldValue('N') * 200).then(() => simLog(`🔔 Buzzer ${block.getFieldValue('N')}×`, 'ls', taskName));
    default:
      return Promise.resolve();
  }
}

async function execStmts(block, inp, taskName) {
  let current = block.getInputTargetBlock(inp);
  while (current && simRunning) {
    await execBlock(current, taskName);
    current = current.getNextBlock();
  }
}

async function runTask(block, taskName) {
  setTaskState(taskName, 'run');
  simLog('⚡ Task started', 'ls', taskName);
  try {
    await execBlock(block, taskName);
  } catch (e) {
    console.error(e);
  }
  if (taskStates[taskName] === 'run') setTaskState(taskName, 'done');
}

export async function runSim() {
  const tops = workspace ? workspace.getTopBlocks(true).filter((b) => b.type === 'b_task_begin') : [];
  if (!tops.length) {
    simLog('⚠ Không có khối TASK nào!', 'ler', null);
    return;
  }
  simRunning = true;
  simStart = Date.now();
  evtBus = 0n;
  eventMap = {};
  waitingBtns = [];
  clearLog();
  simLog(`🚀 JIGSIM START — ${tops.length} tasks`, 'lok', null);
  simDO = {};
  simSR = new Array(24).fill(0);
  diList.forEach((d) => { simDI[d.name] = 0; });
  varList.forEach((v) => { simVAR[v.name] = parseInt(v.init) || 0; });
  updateSimDisplay();
  document.getElementById('btn-run').disabled = true;
  document.getElementById('btn-stop').style.display = 'flex';
  document.getElementById('sd').style.background = 'var(--am)';
  document.getElementById('st').textContent = 'Running';

  const promises = tops.map((b) => runTask(b, b.getFieldValue('TK')));
  await Promise.all(promises);
  if (simRunning) {
    simLog('✅ All tasks done', 'lok', null);
    stopSim();
  }
}

export function resetTask(name) {
  if (!name) return;
  taskStates[name] = 'idle';
  const dot = document.getElementById(`tm-dot-${name}`);
  const st = document.getElementById(`tm-st-${name}`);
  if (dot) dot.className = 'tm-dot';
  if (st) st.textContent = 'IDLE';
  clearEvt(`${name}_DONE`);
  simLog(`↻ Reset task ${name}`, 'lw', null);
}

export function stopSim() {
  simRunning = false;
  waitingBtns.forEach((w) => w.resolve());
  waitingBtns = [];
  document.getElementById('btn-run').disabled = false;
  document.getElementById('btn-stop').style.display = 'none';
  document.getElementById('sd').style.background = 'var(--gn)';
  document.getElementById('st').textContent = 'Ready';
  document.getElementById('sim-bx').textContent = 'IDLE';
}

export function simBtn(btn) {
  simLog(`🖱 BTN ${btn}`, btn === 'START' ? 'lok' : 'ler', null);
  if (btn === 'START' && !simRunning) {
    runSim();
    return;
  }
  if (btn === 'STOP') {
    stopSim();
    return;
  }
  const matched = waitingBtns.filter((w) => w.btn === btn);
  matched.forEach((w) => w.resolve());
  waitingBtns = waitingBtns.filter((w) => w.btn !== btn);
}

export function updateSimDisplay() {
  diList.forEach((d) => {
    const el = document.getElementById(`sdi-${d.name}`);
    if (el) {
      const on = simDI[d.name] || 0;
      el.querySelector('.ioc-d').style.cssText = on
        ? 'background:var(--cy);box-shadow:0 0 5px var(--cy);'
        : 'background:var(--dx);';
      el.classList.toggle('active', !!on);
    }
  });
  doList.forEach((d) => {
    const el = document.getElementById(`sdo-${d.name}`);
    if (el) {
      const on = simDO[d.name] || 0;
      el.querySelector('.ioc-d').style.cssText = on
        ? 'background:var(--gn);box-shadow:0 0 5px var(--gn);'
        : 'background:var(--dx);';
    }
  });
  simSR.forEach((v, i) => {
    const el = document.getElementById(`srb-${i}`);
    if (el) el.classList.toggle('on', v === 1);
  });
}
