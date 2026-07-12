export type WorkbenchFileIconShape =
  | 'folder'
  | 'code'
  | 'react'
  | 'html'
  | 'style'
  | 'markdown'
  | 'config'
  | 'database'
  | 'sheet'
  | 'image'
  | 'document'
  | 'archive'
  | 'audio'
  | 'video'
  | 'package'
  | 'docker'
  | 'git'
  | 'terminal'
  | 'test'
  | 'certificate'
  | 'font'
  | 'binary'
  | 'lock'
  | 'file';

export type WorkbenchFileIconDescriptor = {
  kind: string;
  shape: WorkbenchFileIconShape;
  accent: string;
  label?: string;
};

const defaultFolderIcon = folderIcon('#d99a24');
const defaultFileIcon = fileIcon('file', 'file', '#94a3b8');

const folderIcons: Record<string, WorkbenchFileIconDescriptor> = {
  '.cache': folderIcon('#94a3b8'),
  '.claude': folderIcon('#8b5cf6'),
  '.codex': folderIcon('#0f766e'),
  '.config': folderIcon('#38bdf8'),
  '.docker': folderIcon('#2496ed'),
  '.git': folderIcon('#f05032'),
  '.github': folderIcon('#6e5494'),
  '.idea': folderIcon('#db2777'),
  '.npm': folderIcon('#cb3837'),
  '.storybook': folderIcon('#ff4785'),
  '.trellis': folderIcon('#0f766e'),
  '.vscode': folderIcon('#007acc'),
  '__tests__': folderIcon('#16a34a'),
  api: folderIcon('#0ea5e9'),
  assets: folderIcon('#7c3aed'),
  bin: folderIcon('#64748b'),
  build: folderIcon('#8b5cf6'),
  client: folderIcon('#0891b2'),
  components: folderIcon('#ec4899'),
  config: folderIcon('#38bdf8'),
  coverage: folderIcon('#16a34a'),
  crates: folderIcon('#b45309'),
  database: folderIcon('#0f766e'),
  db: folderIcon('#0f766e'),
  dist: folderIcon('#8b5cf6'),
  docker: folderIcon('#2496ed'),
  docs: folderIcon('#2563eb'),
  examples: folderIcon('#f59e0b'),
  fixtures: folderIcon('#a855f7'),
  fonts: folderIcon('#7c3aed'),
  hooks: folderIcon('#db2777'),
  images: folderIcon('#7c3aed'),
  include: folderIcon('#2563eb'),
  lib: folderIcon('#06b6d4'),
  locales: folderIcon('#0ea5e9'),
  migrations: folderIcon('#0f766e'),
  node_modules: folderIcon('#539e43'),
  packages: folderIcon('#d97706'),
  public: folderIcon('#16a34a'),
  scripts: folderIcon('#0284c7'),
  server: folderIcon('#f97316'),
  src: folderIcon('#2563eb'),
  static: folderIcon('#16a34a'),
  styles: folderIcon('#9333ea'),
  target: folderIcon('#b45309'),
  test: folderIcon('#16a34a'),
  tests: folderIcon('#16a34a'),
  types: folderIcon('#3178c6'),
  vendor: folderIcon('#64748b'),
};

const fileNameIcons: Record<string, WorkbenchFileIconDescriptor> = {
  '.babelrc': configIcon('BABEL', '#f5da55'),
  '.dockerignore': fileIcon('docker', 'docker', '#2496ed'),
  '.editorconfig': configIcon('EC', '#f97316'),
  '.env': configIcon('ENV', '#16a34a'),
  '.eslintignore': configIcon('ES', '#4b32c3'),
  '.eslintrc': configIcon('ES', '#4b32c3'),
  '.gitattributes': fileIcon('git', 'git', '#f05032'),
  '.gitignore': fileIcon('git', 'git', '#f05032'),
  '.gitmodules': fileIcon('git', 'git', '#f05032'),
  '.npmrc': configIcon('NPM', '#cb3837'),
  '.prettierignore': configIcon('P', '#f7b93e'),
  '.prettierrc': configIcon('P', '#f7b93e'),
  '.stylelintrc': configIcon('SL', '#263238'),
  '.yarnrc': configIcon('Y', '#2c8ebb'),
  'biome.json': configIcon('BIO', '#60a5fa'),
  'bun.lock': lockIcon('BUN', '#f472b6'),
  'bun.lockb': lockIcon('BUN', '#f472b6'),
  'cargo.lock': lockIcon('RS', '#b45309'),
  'cargo.toml': fileIcon('rust', 'package', '#b45309', 'RS'),
  'changelog.md': fileIcon('changelog', 'markdown', '#2563eb', 'LOG'),
  'cmakelists.txt': configIcon('CMAKE', '#2563eb'),
  'composer.json': fileIcon('php', 'package', '#777bb4', 'PHP'),
  'composer.lock': lockIcon('PHP', '#777bb4'),
  'deno.json': configIcon('DENO', '#111827'),
  'deno.jsonc': configIcon('DENO', '#111827'),
  'docker-compose.yaml': fileIcon('docker', 'docker', '#2496ed'),
  'docker-compose.yml': fileIcon('docker', 'docker', '#2496ed'),
  'dockerfile': fileIcon('docker', 'docker', '#2496ed'),
  'gemfile': fileIcon('ruby', 'package', '#cc342d', 'RB'),
  'gemfile.lock': lockIcon('RB', '#cc342d'),
  'go.mod': fileIcon('go', 'package', '#00add8', 'GO'),
  'go.sum': lockIcon('GO', '#00add8'),
  'gradle.properties': configIcon('G', '#02303a'),
  'justfile': fileIcon('just', 'terminal', '#f97316', 'J'),
  'license': fileIcon('license', 'document', '#7c3aed', 'LIC'),
  'license.md': fileIcon('license', 'document', '#7c3aed', 'LIC'),
  'makefile': fileIcon('make', 'terminal', '#475569', 'MK'),
  'package-lock.json': lockIcon('NPM', '#cb3837'),
  'package.json': fileIcon('node', 'package', '#cb3837', 'N'),
  'pipfile': fileIcon('python', 'package', '#3776ab', 'PY'),
  'pipfile.lock': lockIcon('PY', '#3776ab'),
  'pnpm-lock.yaml': lockIcon('PNPM', '#f59e0b'),
  'pnpm-workspace.yaml': configIcon('PNPM', '#f59e0b'),
  'poetry.lock': lockIcon('PY', '#3776ab'),
  'pom.xml': fileIcon('maven', 'package', '#c71a36', 'MVN'),
  'procfile': fileIcon('procfile', 'terminal', '#7c3aed', 'PROC'),
  'pyproject.toml': fileIcon('python', 'package', '#3776ab', 'PY'),
  'readme': fileIcon('readme', 'markdown', '#2563eb', 'R'),
  'readme.md': fileIcon('readme', 'markdown', '#2563eb', 'R'),
  'requirements.txt': fileIcon('python', 'package', '#3776ab', 'PY'),
  'rust-toolchain': configIcon('RS', '#b45309'),
  'rust-toolchain.toml': configIcon('RS', '#b45309'),
  'settings.gradle': configIcon('G', '#02303a'),
  'settings.gradle.kts': configIcon('G', '#02303a'),
  'taskfile.yaml': fileIcon('taskfile', 'terminal', '#0ea5e9', 'TASK'),
  'taskfile.yml': fileIcon('taskfile', 'terminal', '#0ea5e9', 'TASK'),
  'tsconfig.json': configIcon('TS', '#3178c6'),
  'vite.config.js': configIcon('VITE', '#646cff'),
  'vite.config.mjs': configIcon('VITE', '#646cff'),
  'vite.config.ts': configIcon('VITE', '#646cff'),
  'webpack.config.js': configIcon('WP', '#1c78c0'),
  'webpack.config.ts': configIcon('WP', '#1c78c0'),
  'yarn.lock': lockIcon('Y', '#2c8ebb'),
};

const extensionIcons: Record<string, WorkbenchFileIconDescriptor> = {
  '7z': archiveIcon(),
  aac: fileIcon('audio', 'audio', '#db2777', 'AAC'),
  ai: fileIcon('illustrator', 'image', '#f59e0b', 'AI'),
  apk: fileIcon('android-package', 'package', '#3ddc84', 'APK'),
  astro: fileIcon('astro', 'html', '#ff5d01', 'A'),
  avi: fileIcon('video', 'video', '#7c3aed', 'AVI'),
  bash: terminalIcon('SH'),
  bat: terminalIcon('BAT', '#2563eb'),
  bmp: imageIcon('BMP'),
  bz2: archiveIcon(),
  c: codeIcon('c', 'C', '#2563eb'),
  cc: codeIcon('cpp', 'C++', '#2563eb'),
  cer: certificateIcon('CER'),
  cfg: configIcon('CFG'),
  class: fileIcon('java-binary', 'binary', '#e76f00', 'JVM'),
  clj: codeIcon('clojure', 'CLJ', '#5881d8'),
  cljs: codeIcon('clojure', 'CLJS', '#5881d8'),
  cmd: terminalIcon('CMD', '#2563eb'),
  conf: configIcon('CONF'),
  cpp: codeIcon('cpp', 'C++', '#2563eb'),
  crt: certificateIcon('CRT'),
  cs: codeIcon('csharp', 'C#', '#68217a'),
  css: fileIcon('css', 'style', '#2563eb', 'CSS'),
  csv: fileIcon('csv', 'sheet', '#15803d', 'CSV'),
  cts: codeIcon('typescript', 'TS', '#3178c6'),
  cxx: codeIcon('cpp', 'C++', '#2563eb'),
  dart: codeIcon('dart', 'DART', '#0175c2'),
  db: fileIcon('database', 'database', '#0f766e', 'DB'),
  deb: fileIcon('debian-package', 'package', '#a80030', 'DEB'),
  dll: fileIcon('binary', 'binary', '#64748b', 'DLL'),
  doc: documentIcon('DOC', '#2563eb'),
  docx: documentIcon('DOCX', '#2563eb'),
  eot: fontIcon('EOT'),
  erb: codeIcon('ruby', 'ERB', '#cc342d'),
  erl: codeIcon('erlang', 'ERL', '#a90533'),
  ex: codeIcon('elixir', 'EX', '#6e4a7e'),
  exe: fileIcon('executable', 'binary', '#475569', 'EXE'),
  exs: codeIcon('elixir', 'EXS', '#6e4a7e'),
  fish: terminalIcon('FISH', '#4eaa25'),
  flac: fileIcon('audio', 'audio', '#db2777', 'FLAC'),
  fs: codeIcon('fsharp', 'F#', '#378bba'),
  fsx: codeIcon('fsharp', 'FSX', '#378bba'),
  gif: imageIcon('GIF'),
  go: codeIcon('go', 'GO', '#00add8'),
  gql: codeIcon('graphql', 'GQL', '#e10098'),
  gradle: configIcon('G', '#02303a'),
  graphql: codeIcon('graphql', 'GQL', '#e10098'),
  groovy: codeIcon('groovy', 'GVY', '#4298b8'),
  gz: archiveIcon(),
  h: codeIcon('c-header', 'H', '#2563eb'),
  hpp: codeIcon('cpp-header', 'H++', '#2563eb'),
  hrl: codeIcon('erlang', 'HRL', '#a90533'),
  hs: codeIcon('haskell', 'HS', '#5d4f85'),
  htm: fileIcon('html', 'html', '#e34f26', 'HTML'),
  html: fileIcon('html', 'html', '#e34f26', 'HTML'),
  ico: imageIcon('ICO'),
  ini: configIcon('INI'),
  ipynb: codeIcon('jupyter', 'NB', '#f37626'),
  jar: fileIcon('java-package', 'package', '#e76f00', 'JAR'),
  java: codeIcon('java', 'JAVA', '#e76f00'),
  jpeg: imageIcon('JPG'),
  jpg: imageIcon('JPG'),
  js: codeIcon('javascript', 'JS', '#ca8a04'),
  json: fileIcon('json', 'config', '#d97706', '{}'),
  json5: fileIcon('json', 'config', '#d97706', '{}'),
  jsonc: fileIcon('json', 'config', '#d97706', '{}'),
  jsx: fileIcon('react', 'react', '#0891b2'),
  key: certificateIcon('KEY', '#64748b'),
  kt: codeIcon('kotlin', 'KT', '#7c3aed'),
  kts: codeIcon('kotlin', 'KTS', '#7c3aed'),
  less: fileIcon('less', 'style', '#1d365d', 'LESS'),
  lock: lockIcon(),
  log: documentIcon('LOG', '#64748b'),
  lua: codeIcon('lua', 'LUA', '#000080'),
  m: codeIcon('objective-c', 'OBJ-C', '#2563eb'),
  md: fileIcon('markdown', 'markdown', '#2563eb', 'MD'),
  mdx: fileIcon('mdx', 'markdown', '#f59e0b', 'MDX'),
  mjs: codeIcon('javascript', 'JS', '#ca8a04'),
  mkv: fileIcon('video', 'video', '#7c3aed', 'MKV'),
  ml: codeIcon('ocaml', 'ML', '#f97316'),
  mov: fileIcon('video', 'video', '#7c3aed', 'MOV'),
  mp3: fileIcon('audio', 'audio', '#db2777', 'MP3'),
  mp4: fileIcon('video', 'video', '#7c3aed', 'MP4'),
  msi: fileIcon('windows-package', 'package', '#0f766e', 'MSI'),
  mts: codeIcon('typescript', 'TS', '#3178c6'),
  nim: codeIcon('nim', 'NIM', '#d6b519'),
  odt: documentIcon('ODT', '#2563eb'),
  ogg: fileIcon('audio', 'audio', '#db2777', 'OGG'),
  otf: fontIcon('OTF'),
  pdf: documentIcon('PDF', '#dc2626'),
  pem: certificateIcon('PEM'),
  php: codeIcon('php', 'PHP', '#777bb4'),
  pl: codeIcon('perl', 'PL', '#39457e'),
  png: imageIcon('PNG'),
  ppk: certificateIcon('PPK', '#64748b'),
  ppt: documentIcon('PPT', '#d24726'),
  pptx: documentIcon('PPTX', '#d24726'),
  prisma: fileIcon('prisma', 'database', '#0f172a', 'PR'),
  properties: configIcon('PROP'),
  proto: codeIcon('protobuf', 'PB', '#0ea5e9'),
  ps1: terminalIcon('PS', '#2563eb'),
  psd: fileIcon('photoshop', 'image', '#31a8ff', 'PSD'),
  py: codeIcon('python', 'PY', '#3776ab'),
  pyw: codeIcon('python', 'PY', '#3776ab'),
  r: codeIcon('r', 'R', '#276dc3'),
  rar: archiveIcon(),
  rb: codeIcon('ruby', 'RB', '#cc342d'),
  rpm: fileIcon('rpm-package', 'package', '#0f766e', 'RPM'),
  rs: codeIcon('rust', 'RS', '#b45309'),
  rtf: documentIcon('RTF'),
  sass: fileIcon('sass', 'style', '#cc6699', 'SASS'),
  scala: codeIcon('scala', 'SC', '#dc322f'),
  scss: fileIcon('scss', 'style', '#cc6699', 'SCSS'),
  sh: terminalIcon('SH'),
  sketch: fileIcon('sketch', 'image', '#f7b500', 'SK'),
  so: fileIcon('binary', 'binary', '#64748b', 'SO'),
  sol: codeIcon('solidity', 'SOL', '#64748b'),
  sql: fileIcon('sql', 'database', '#0f766e', 'SQL'),
  sqlite: fileIcon('sqlite', 'database', '#0f766e', 'DB'),
  sqlite3: fileIcon('sqlite', 'database', '#0f766e', 'DB'),
  svelte: fileIcon('svelte', 'html', '#ff3e00', 'S'),
  svg: imageIcon('SVG'),
  swift: codeIcon('swift', 'SW', '#f05138'),
  tar: archiveIcon(),
  tex: documentIcon('TEX', '#008080'),
  tgz: archiveIcon(),
  toml: configIcon('TOML'),
  ts: codeIcon('typescript', 'TS', '#3178c6'),
  tsx: fileIcon('react', 'react', '#0891b2'),
  tsv: fileIcon('tsv', 'sheet', '#15803d', 'TSV'),
  ttf: fontIcon('TTF'),
  txt: documentIcon('TXT'),
  vb: codeIcon('visual-basic', 'VB', '#68217a'),
  vue: fileIcon('vue', 'html', '#42b883', 'V'),
  wasm: fileIcon('wasm', 'binary', '#654ff0', 'WASM'),
  wav: fileIcon('audio', 'audio', '#db2777', 'WAV'),
  webm: fileIcon('video', 'video', '#7c3aed', 'WEBM'),
  webp: imageIcon('WEBP'),
  woff: fontIcon('WOFF'),
  woff2: fontIcon('W2'),
  xls: fileIcon('excel', 'sheet', '#15803d', 'XLS'),
  xlsx: fileIcon('excel', 'sheet', '#15803d', 'XLSX'),
  xml: configIcon('XML', '#f97316'),
  xz: archiveIcon(),
  yaml: configIcon('YAML'),
  yml: configIcon('YAML'),
  zig: codeIcon('zig', 'ZIG', '#f7a41d'),
  zip: archiveIcon(),
  zsh: terminalIcon('ZSH'),
};

export function resolveWorkbenchFileIconDescriptor(
  filePath: string,
  type: 'directory' | 'file',
): WorkbenchFileIconDescriptor {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const name = normalizedPath.split('/').filter(Boolean).pop()?.toLowerCase() ?? normalizedPath.toLowerCase();

  if (type === 'directory') {
    return folderIcons[name] ?? defaultFolderIcon;
  }

  const specialIcon = resolveSpecialFileNameIcon(name);
  if (specialIcon) {
    return specialIcon;
  }

  return extensionIcons[getFileExtension(name)] ?? defaultFileIcon;
}

export function getWorkbenchFileIconKind(filePath: string, type: 'directory' | 'file') {
  return resolveWorkbenchFileIconDescriptor(filePath, type).kind;
}

function resolveSpecialFileNameIcon(name: string) {
  if (fileNameIcons[name]) {
    return fileNameIcons[name];
  }
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) {
    return fileNameIcons.dockerfile;
  }
  if (name === '.env' || name.startsWith('.env.')) {
    return fileNameIcons['.env'];
  }
  if (name === 'readme' || name.startsWith('readme.')) {
    return fileNameIcons['readme.md'];
  }
  if (name === 'license' || name.startsWith('license.')) {
    return fileNameIcons.license;
  }
  if (name === 'changelog' || name.startsWith('changelog.')) {
    return fileNameIcons['changelog.md'];
  }
  if (/\.(test|spec)\.[^.]+$/.test(name) || name.includes('.stories.')) {
    return fileIcon('test', 'test', '#16a34a', 'TST');
  }
  if (name.endsWith('.lock')) {
    return lockIcon();
  }
  if (/^(vite|webpack|rollup|eslint|prettier|postcss|tailwind|vitest|jest|playwright|babel)\.config\./.test(name)) {
    return configIcon('CFG', '#646cff');
  }
  return null;
}

function getFileExtension(name: string) {
  const extensionIndex = name.lastIndexOf('.');
  return extensionIndex > -1 ? name.slice(extensionIndex + 1) : '';
}

function folderIcon(accent: string): WorkbenchFileIconDescriptor {
  return { kind: 'folder', shape: 'folder', accent };
}

function fileIcon(
  kind: string,
  shape: WorkbenchFileIconShape,
  accent: string,
  label?: string,
): WorkbenchFileIconDescriptor {
  return { kind, shape, accent, label };
}

function codeIcon(kind: string, label: string, accent: string) {
  return fileIcon(kind, 'code', accent, label);
}

function configIcon(label: string, accent = '#d97706') {
  return fileIcon('config', 'config', accent, label);
}

function terminalIcon(label: string, accent = '#4eaa25') {
  return fileIcon('terminal', 'terminal', accent, label);
}

function documentIcon(label: string, accent = '#64748b') {
  return fileIcon('document', 'document', accent, label);
}

function imageIcon(label: string) {
  return fileIcon('image', 'image', '#7c3aed', label);
}

function archiveIcon() {
  return fileIcon('archive', 'archive', '#b91c1c', 'ZIP');
}

function certificateIcon(label: string, accent = '#059669') {
  return fileIcon('certificate', 'certificate', accent, label);
}

function fontIcon(label: string) {
  return fileIcon('font', 'font', '#7c3aed', label);
}

function lockIcon(label = 'LOCK', accent = '#64748b') {
  return fileIcon('lock', 'lock', accent, label);
}
