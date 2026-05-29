export let diList = [];
export let doList = [];
export let cylList = [];
export let motList = [];
export let varList = [];
export let taskList = [];
export let workspace = null;
export let bits595 = [...Array(24)].map((_, i) => ({ name: 'Q' + i }));

export function setWorkspace(w) {
  workspace = w;
  if (typeof window !== 'undefined') {
    window.workspace = w;
  }
}

export const noDI = () => {
  const options = diList.filter((d) => d.name).map((d) => [d.name, d.name]);
  return options.length ? options : [['—', 'NONE']];
};
export const noDO = () => {
  const options = doList.filter((d) => d.name).map((d) => [d.name, d.name]);
  return options.length ? options : [['—', 'NONE']];
};
export const noCYL = () => {
  const options = cylList.filter((c) => c.name).map((c) => [c.name, c.name]);
  return options.length ? options : [['—', 'NONE']];
};
export const noMOT = () => {
  const options = motList.filter((m) => m.name).map((m) => [m.name, m.name]);
  return options.length ? options : [['—', 'NONE']];
};
export const noSR = () => {
  const options = bits595
    .filter((b) => b.name && !b.name.startsWith('Q'))
    .map((b) => [b.name, b.name]);
  return options.length ? options : [['—', 'NONE']];
};
export const noVAR = () => {
  const options = varList.filter((v) => v.name).map((v) => [v.name, v.name]);
  return options.length ? options : [['—', 'NONE']];
};
export const noTASK = () => {
  const options = taskList.filter((t) => t.name).map((t) => [t.name, t.name]);
  return options.length ? options : [['—', 'NONE']];
};

export const noEVT = () => {
  const evts = [];
  if (workspace) {
    workspace
      .getAllBlocks()
      .filter((b) => b.type === 'b_emit')
      .forEach((b) => {
        const n = b.getFieldValue('EV');
        if (n && n !== 'NONE') evts.push([n, n]);
      });
  }
  taskList.filter((t) => t.name).forEach((t) => evts.push([`${t.name}_DONE`, `${t.name}_DONE`]));
  const unique = [...new Map(evts.map((e) => [e[0], e])).values()];
  return unique.length ? unique : [['EVT', 'EVT']];
};
