#!/usr/bin/env node
// awu-ui · 零依赖扫描器
// 用法：node scripts/slop-scan.mjs <文件或目录...> [--json] [--quiet] [--strict]
// 退出码：有 P0 → 1；--strict 下有任何问题 → 1。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, resolve, sep } from 'node:path';

const MARKUP = new Set(['.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte', '.astro', '.cshtml', '.razor']);
const STYLE = new Set(['.css', '.scss', '.sass', '.less']);
const XAML = new Set(['.xaml', '.axaml']);
const QML = new Set(['.qml']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj', '.next', 'coverage', 'vendor', '.venv', 'target']);

const SEV_ORDER = { P0: 0, P1: 1, P2: 2 };

// where: 'markup' | 'style' | 'xaml' | 'qml' | 'any'
const RULES = [
  // —— 不交付 ——
  { id: 'text-gradient', sev: 'P0', where: 'markup+style', re: /(bg-clip-text|background-clip:\s*text|-webkit-background-clip:\s*text)/i,
    msg: '文字填充了渐变', fix: '改纯色，重点靠字号和字重' },
  { id: 'violet-wash', sev: 'P0', where: 'markup+style', re: /linear-gradient\([^)]*(purple|violet|indigo|fuchsia|#7c3aed|#8b5cf6|#6366f1|#a855f7|#4f46e5|#c026d3)/i,
    msg: '紫、靛、品红渐变的背景或按钮', fix: '一个主色加一条中性阶，层次用明度差' },
  { id: 'placeholder', sev: 'P0', where: 'any', re: /(lorem ipsum|dolor sit amet|(TODO|FIXME):?\s*(replace|content|copy|替换|换成)|这里是(描述|说明|标题|占位))/i,
    msg: '占位文案留在了成品里', fix: '写真实内容，或者整块删掉' },
  { id: 'invented-stat', sev: 'P0', where: 'markup', re: /(\b99(\.\d+)?\s*%|\b\d{1,3}(\.\d+)?\s*%\s*(faster|increase|more|accuracy|uptime|更|提升)|\b\d[\d,]{2,}\+?\s*(teams|companies|customers|团队|企业|用户)\s*(信赖|trust|use|使用)|\b10x\b|\b1000x\b)/i,
    msg: '没有出处的精度或规模数字', fix: '删掉，或者补上口径和出处' },

  // —— 默认值 ——
  { id: 'caps-tracking', sev: 'P1', where: 'markup+style', re: /(uppercase[^"'<]{0,80}tracking-(wide|wider|widest)|tracking-(wide|wider|widest)[^"'<]{0,80}uppercase|letter-spacing:\s*0?\.\d+em[^;]{0,60}text-transform:\s*uppercase)/i,
    msg: '全大写加宽字距的小标签', fix: '换回正常大小写，用字重拉开差异' },
  { id: 'inter-only', sev: 'P1', where: 'markup+style+xaml', re: /(font-family:[^;]*\bInter\b|font-\[Inter|fontFamily="Inter")/i,
    msg: '整站只有一种默认无衬线', fix: '正文留中性字体，标题另选字面；桌面优先系统栈' },
  { id: 'glass-panel', sev: 'P1', where: 'markup+style', re: /(backdrop-blur|backdrop-filter:\s*blur)/i,
    msg: '毛玻璃面板', fix: '实色加细边框；只有真浮层才用阴影' },
  { id: 'icon-box', sev: 'P1', where: 'markup', re: /class="[^"]*rounded-(lg|xl|2xl)[^"]*bg-[a-z]+-(50|100|200)[^"]*"[^>]*>\s*<(svg|Icon|i\b)/i,
    msg: '图标外面套一个圆角色块', fix: '去掉色块，图标并到标题行或不放' },
  { id: 'novelty-badge', sev: 'P1', where: 'markup', re: /(badge|pill)[^"]*"[^>]*>\s*(Beta|BETA|New|NEW|Alpha|AI-Powered|AI 驱动)\s*</,
    msg: '标题上方挂 BETA / NEW / AI 徽章', fix: '删掉；版本状态放进关于页或更新日志' },
  { id: 'marketing-filler', sev: 'P1', where: 'markup', re: /\b(elevate|seamless(ly)?|unleash|supercharge|next-gen|revolutioniz\w*|effortless(ly)?|game-chang\w*|cutting-edge)\b|赋能|一站式|无缝(衔接|集成|体验)|颠覆|重新定义/i,
    msg: '营销填充词', fix: '换成动词加对象加结果，说清做了什么' },
  { id: 'literal-color', sev: 'P1', where: 'xaml+qml', re: /(Background|Foreground|Fill|Stroke|Color|BorderBrush|color)\s*[:=]\s*"#([0-9A-Fa-f]{3,8})"/,
    msg: '视图里写死了颜色字面值', fix: '颜色收进主题资源，视图只引用键' },
  { id: 'page-padding', sev: 'P1', where: 'xaml+qml',
    test: (line) => {
      const m = /(?:Margin|Padding|Spacing)\s*[=:]\s*"([^"]*)"/.exec(line) || /(?:margin|padding)\s*:\s*"?([^";]*)/.exec(line);
      if (!m) return false;
      return m[1].split(/[\s,]+/).some((n) => /^\d+(\.\d+)?$/.test(n) && Number(n) >= 32);
    },
    msg: '桌面内容用了 ≥32px 的外边距或分节留白', fix: '内容边距收到 12–16px，分组靠 8/12 的间距' },

  // —— 工艺 ——
  { id: 'radius-shadow', sev: 'P2', where: 'markup', re: /rounded-(xl|2xl|3xl)[^"]*shadow-(md|lg|xl|2xl)/i,
    msg: '大圆角加大阴影铺满所有容器', fix: '一套圆角一套阴影，同一层级别混' },
  { id: 'step-number', sev: 'P2', where: 'markup', re: />\s*0[1-9]\s*</,
    msg: '卡片上的装饰序号', fix: '删掉；只有真流程才编号，且顺序要能验证' },
  { id: 'cta-arrow', sev: 'P2', where: 'markup', re: /(了解更多|Learn more|Get started|开始使用)\s*(→|->|›)/i,
    msg: '按钮文案后面焊了一个箭头', fix: '让整块可点，或者只留一个动词' },
  { id: 'emoji', sev: 'P2', where: 'any', re: /[\u{1F300}-\u{1FAFF}\u{2728}\u{26A1}\u{1F680}\u{2B50}]/u,
    msg: '标题或按钮里用了表情', fix: '删掉；要图标就用图标' },
  { id: 'ease-in', sev: 'P2', where: 'markup+style', re: /(transition[^;]*\bease-in\b(?!-out))|(cubic-bezier\(\s*\.?\d+\s*,\s*-)/i,
    msg: '进入动画用了 ease-in 或回弹曲线', fix: '进入 ease-out，退出 ease-in，120–240ms' },
  { id: 'layout-anim', sev: 'P2', where: 'markup+style', re: /transition[^;]*\b(width|height|top|left|margin)\b/i,
    msg: '动画改 width/height/top/left', fix: '只动 transform 和 opacity' },
  { id: 'group-frame', sev: 'P2', where: 'xaml', re: /<GroupBox\s+Header=/,
    msg: '框加标题包住本来就有标签的字段', fix: '去掉框和标题，用间距或一条分隔线分组' },
  { id: 'window-footer', sev: 'P2', where: 'xaml+qml', re: /(©|Copyright|备案|ICP 备|京ICP|沪ICP)/i,
    msg: '桌面窗口里出现版权或备案行', fix: '删掉；桌面应用没有页脚' },
  { id: 'chrome-missing', sev: 'P1', where: 'xaml',
    test: (line) => /(WindowStyle\s*=\s*"None"|AllowsTransparency\s*=\s*"True")/.test(line) && !/WindowChrome/.test(line),
    msg: '无边框窗口但没给拖拽区', fix: '加 WindowChrome 或 CaptionHeight，控件区排除拖拽' },
];

function classify(file) {
  const e = extname(file).toLowerCase();
  if (MARKUP.has(e)) return { kind: 'markup' };
  if (STYLE.has(e)) return { kind: 'style' };
  if (XAML.has(e)) return { kind: 'xaml' };
  if (QML.has(e)) return { kind: 'qml' };
  return null;
}

function walk(target, out) {
  let st;
  try { st = statSync(target); } catch { return; }
  if (st.isFile()) { out.push(target); return; }
  if (!st.isDirectory()) return;
  for (const name of readdirSync(target)) {
    if (name.startsWith('.')) continue;
    if (SKIP_DIRS.has(name)) continue;
    walk(join(target, name), out);
  }
}

function applies(where, kind) {
  if (where === 'any') return true;
  return where.split('+').includes(kind);
}

function scanFile(file) {
  const cls = classify(file);
  if (!cls) return [];
  const kind = cls.kind;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const lines = text.split(/\r?\n/);
  const findings = [];
  const seen = new Set();

  const add = (id, sev, msg, fix, line, col = 1, snippet = '') => {
    const key = `${id}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file, line, col, id, sev, msg, fix, snippet, fileLevel: line === 0 });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 4000) continue;
    for (const rule of RULES) {
      if (!applies(rule.where, kind)) continue;
      let hit = false;
      let col = 1;
      if (rule.test) {
        hit = rule.test(line);
      } else {
        const m = rule.re.exec(line);
        if (m) { hit = true; col = m.index + 1; }
      }
      if (hit) add(rule.id, rule.sev, rule.msg, rule.fix, i + 1, col, line.trim().slice(0, 100));
    }
  }

  if (kind === 'markup') {
    // 标题上方的小字标签：只看结构，不认类名；最多往上找三行单个元素
    for (let i = 1; i < lines.length; i++) {
      if (!/<h[12][^>]*>/i.test(lines[i])) continue;
      for (let k = 1; k <= 3 && i - k >= 0; k++) {
        const prev = lines[i - k];
        if (!prev.trim() || /<\/h[12]>/i.test(prev)) break;
        const spaced = /(uppercase|tracking-(wide|wider|widest)|letter-spacing)/i.test(prev);
        const m = /^\s*<(p|span|div)[^>]*>\s*([^<]{1,24})\s*<\/\1>\s*$/i.exec(prev);
        const plainLabel = !!m && !/[/·|]/.test(m[2]) && !/<(a|time)\b/i.test(prev);
        if (spaced || plainLabel) {
          add('top-label', 'P1', '标题上方多一行小字标签', '删掉；用字号差距和上方留白分区', i - k + 1, 1, prev.trim().slice(0, 100));
        }
        if (!m && !spaced) break;
      }
    }

    const fade = (text.match(/\b(animate-in|fade-up|fade-in|data-aos|motion-safe:animate)\b/g) || []).length;
    if (fade >= 3) add('scroll-fade', 'P1', `每节都加淡入（${fade} 处）`, '只给状态变化加动效', 0);

    if (/<(button|input|select|textarea|a\s[^>]*href)/i.test(text) && !/(:focus-visible|:focus\b|focus:ring|focus:outline)/i.test(text)) {
      add('focus-missing', 'P1', '有交互控件，但整份样式没有焦点样式', '加 2px 可见焦点环，和背景对比 3:1 以上', 0);
    }

    if (/grid-cols-3/.test(text) && (text.match(/rounded-(xl|2xl|3xl)/g) || []).length >= 3) {
      add('card-trio', 'P1', '三张等宽卡片并排的骨架', '换成产品自己的内容形态：列表、表格、真实界面', 0);
    }

    const radii = new Set((text.match(/rounded-(none|sm|md|lg|xl|2xl|3xl|full)/g) || []).map((s) => s.slice(8)));
    if (radii.size > 3) add('radius-drift', 'P2', `同页出现 ${radii.size} 种圆角：${[...radii].join('/')}`, '收到三档：控件、容器、胶囊', 0);

    const labels = {};
    for (const m of text.matchAll(/<(a|button)[^>]*>\s*([^<]{2,14})\s*<\/\1>/gi)) {
      const t = m[2].trim();
      labels[t] = (labels[t] || 0) + 1;
    }
    for (const [t, n] of Object.entries(labels)) {
      if (n >= 3) add('cta-repeat', 'P2', `同一句行动号召出现 ${n} 次：「${t}」`, '只在决策点留一个主动作', 0);
    }

    for (let i = 0; i < lines.length - 1; i++) {
      if (!/<h[12][^>]*>[^<]{2,}<\/h[12]>/i.test(lines[i])) continue;
      for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
        if (/<p[^>]*class="[^"]*text-(sm|xs|base)[^"]*text-(muted-foreground|neutral|gray|slate|zinc)/i.test(lines[j])) {
          add('echo-subtitle', 'P2', '标题下面紧跟一句弱化的复述', '删掉；有事实才留', j + 1, 1, lines[j].trim().slice(0, 100));
          break;
        }
      }
    }

    if (/(@keyframes|animation:|transition:)/i.test(text) && !/prefers-reduced-motion/i.test(text)) {
      add('motion-guard', 'P2', '有动效，但没有 reduced-motion 分支', '加 reduce 分支，去掉位移和循环', 0);
    }
  }

  return findings;
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const targets = argv.filter((a) => !a.startsWith('--'));
if (!targets.length) targets.push('.');
if (flags.has('--help')) {
  console.log('用法: node scripts/slop-scan.mjs <文件或目录...> [--json] [--quiet] [--strict]');
  process.exit(0);
}

const files = [];
for (const t of targets) {
  const abs = resolve(t);
  try { statSync(abs); } catch { console.error(`跳过不存在的路径: ${t}`); continue; }
  walk(abs, files);
}
const unique = [...new Set(files)].filter((f) => classify(f));
const all = unique.flatMap(scanFile);
const rel = (f) => relative(process.cwd(), f).split(sep).join('/');

all.sort((a, b) =>
  rel(a.file).localeCompare(rel(b.file)) ||
  SEV_ORDER[a.sev] - SEV_ORDER[b.sev] ||
  Number(a.fileLevel) - Number(b.fileLevel) ||
  a.line - b.line
);

const sum = { files: unique.length, findings: all.length, P0: 0, P1: 0, P2: 0 };
for (const f of all) sum[f.sev]++;

if (flags.has('--json')) {
  console.log(JSON.stringify({ summary: sum, findings: all.map((f) => ({ ...f, file: rel(f.file) })) }, null, 2));
} else {
  console.log(`\nawu-ui · ${sum.files} 个文件 · ${sum.findings} 处（P0 ${sum.P0} · P1 ${sum.P1} · P2 ${sum.P2}）\n`);
  const shown = flags.has('--quiet') ? all.filter((f) => f.sev === 'P0') : all;
  let current = null;
  for (const f of shown) {
    const name = rel(f.file);
    if (name !== current) { current = name; console.log(name); }
    const loc = f.fileLevel ? '  整份' : `${String(f.line).padStart(4)}:${String(f.col).padEnd(3)}`;
    console.log(`  [${f.sev}] ${loc} ${f.id}`);
    console.log(`         ${f.msg}`);
    if (!flags.has('--quiet')) {
      console.log(`         → ${f.fix}`);
      if (f.snippet) console.log(`         | ${f.snippet}`);
    }
  }
  if (!all.length) console.log('  没有可判定的破绽。层级、间距、容器选择还得人工过一遍。');
  console.log(`\n分级：P0 硬门槛（不交付）· P1 默认值（本轮修）· P2 工艺（记待办）\n`);
}

process.exit(sum.P0 > 0 || (flags.has('--strict') && sum.findings > 0) ? 1 : 0);
