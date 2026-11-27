import {
  ACESFilmicToneMapping, AmbientLight, Box3, BoxGeometry, BufferGeometry, CapsuleGeometry, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, ExtrudeGeometry, Group, IcosahedronGeometry, Vector3, Material, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera,
  PMREMGenerator, Scene, Shape, SphereGeometry, Texture, TorusGeometry, TorusKnotGeometry, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Part3D, Scene3D } from '../editor/doc';

/**
 * Um único WebGLRenderer para a página toda (o navegador limita os contextos a ~16). Cada elemento 3D tem um
 * <canvas> 2D próprio: renderiza-se no canvas do renderer e copia-se com drawImage, na mesma tarefa.
 */
let shared: { renderer: WebGLRenderer; env: Texture } | null | undefined;
let sized = [0, 0];

function gl() {
  if (shared !== undefined) return shared;
  try {
    const renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
    // Ambiente gerado aqui (nada é baixado): é o que faz o metal e o vidro terem o que refletir.
    const pmrem = new PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    shared = { renderer, env };
  } catch {
    shared = null; // sem WebGL: o elemento fica só com o fundo
  }
  return shared;
}

const rad = (d: number) => (d * Math.PI) / 180;

function material(kind: Scene3D['material'], color: string): Material {
  const c = new Color(color);
  switch (kind) {
    case 'metal':
      return new MeshStandardMaterial({ color: c, metalness: 1, roughness: 0.22 });
    case 'vidro':
      return new MeshPhysicalMaterial({ color: c, transmission: 1, thickness: 0.9, roughness: 0.06, ior: 1.45, metalness: 0 });
    case 'brilho':
      return new MeshPhysicalMaterial({ color: c, roughness: 0.45, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 });
    case 'arame':
      return new MeshBasicMaterial({ color: c, wireframe: true });
    default:
      return new MeshStandardMaterial({ color: c, roughness: 0.88, metalness: 0 });
  }
}

function cardGeometry() {
  const w = 1.6, h = 1.0, r = 0.1;
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const g = new ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 14 });
  g.translate(0, 0, -0.015);
  return g;
}

function geometry(shape: Scene3D['shape']): BufferGeometry {
  switch (shape) {
    case 'cubo': return new RoundedBoxGeometry(1.3, 1.3, 1.3, 5, 0.12);
    case 'esfera': return new SphereGeometry(0.95, 64, 48);
    case 'toro': return new TorusGeometry(0.72, 0.28, 48, 120);
    case 'no': return new TorusKnotGeometry(0.62, 0.22, 200, 28);
    case 'cone': return new ConeGeometry(0.82, 1.6, 64);
    case 'icosaedro': return new IcosahedronGeometry(1, 0);
    case 'capsula': return new CapsuleGeometry(0.5, 0.9, 16, 32);
    default: return cardGeometry();
  }
}

/** Geometrias de peça: tamanho 1, centradas na origem (a escala de cada peça vem do mesh). */
function partGeometry(shape: Part3D['shape']): BufferGeometry {
  switch (shape) {
    case 'esfera': return new SphereGeometry(0.5, 40, 28);
    case 'cilindro': return new CylinderGeometry(0.5, 0.5, 1, 48);
    case 'cone': return new ConeGeometry(0.5, 1, 48);
    case 'toro': {
      // Deitado (anel no plano x-z, como confeito em volta do bolo); tubo fino: 0,12 do raio externo.
      const g = new TorusGeometry(0.44, 0.06, 20, 64);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'capsula': return new CapsuleGeometry(0.25, 0.5, 12, 24);
    case 'semiesfera': {
      // Metade de cima, fechada embaixo com um disco; desce 0,25 para a caixa ficar centrada em y.
      const top = new SphereGeometry(0.5, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const base = new CircleGeometry(0.5, 40);
      base.rotateX(Math.PI / 2);
      const g = mergeGeometries([top, base])!;
      top.dispose();
      base.dispose();
      g.translate(0, -0.25, 0);
      return g;
    }
    default: return new BoxGeometry(1, 1, 1);
  }
}

function lights(scene: Scene, s: Scene3D) {
  const dir = (color: string | number, i: number, x: number, y: number, z: number) => {
    const l = new DirectionalLight(color, i);
    l.position.set(x, y, z);
    scene.add(l);
  };
  if (s.light === 'suave') {
    scene.add(new AmbientLight(0xffffff, 0.9));
    dir(0xffffff, 1.4, 3, 4, 5);
    scene.environmentIntensity = 0.6;
  } else if (s.light === 'contraste') {
    scene.add(new AmbientLight(0xffffff, 0.05));
    dir(0xffffff, 3.6, 5, 2, 2);
    dir(s.color2, 2.4, -4, -1, -3);
    scene.environmentIntensity = 0.25;
  } else {
    scene.add(new AmbientLight(0xffffff, 0.25));
    dir(0xffffff, 2.2, 4, 5, 6);
    dir(0xffffff, 0.6, -5, 1, 3);
    dir(s.color2, 2.5, -2, 3, -5);
    scene.environmentIntensity = 1;
  }
}

/** O que só muda quando forma, material, cores ou luz mudam (o resto é pose, lida a cada quadro). */
const looks = (s: Scene3D) => [s.shape, s.material, s.color, s.color2, s.light, s.parts?.length ? JSON.stringify(s.parts) : ''].join('|');

function build(s: Scene3D) {
  const scene = new Scene();
  scene.environment = gl()!.env;
  lights(scene, s);
  const tilt = new Group();
  const obj = new Group();
  tilt.add(obj);
  scene.add(tilt);
  if (s.parts?.length) {
    const geos = new Map<string, BufferGeometry>();
    const inner = new Group();
    for (const p of s.parts) {
      if (!geos.has(p.shape)) geos.set(p.shape, partGeometry(p.shape));
      const m = new Mesh(geos.get(p.shape), material(p.material, p.color));
      m.position.set(p.x, p.y, p.z);
      m.scale.set(p.sx, p.sy, p.sz);
      m.rotation.set(rad(p.rx), rad(p.ry), rad(p.rz));
      inner.add(m);
    }
    // Enquadra pelo bounding box: centraliza e escala para a esfera que contém o conjunto ter raio 1
    // (a câmera já conta com um objeto de raio ~1,3). Girar/flutuar atua no grupo externo, em torno do centro.
    const box = new Box3().setFromObject(inner);
    const c = box.getCenter(new Vector3());
    const k = 1 / Math.max(box.getSize(new Vector3()).length() / 2, 1e-3);
    inner.scale.setScalar(k);
    inner.position.copy(c).multiplyScalar(-k);
    obj.add(inner);
  } else if (s.shape === 'cartoes') {
    // Três cartões em leque: o da frente na cor principal, os de trás na segunda (o do meio um pouco mais escuro).
    const geo = cardGeometry();
    const mid = '#' + new Color(s.color2).multiplyScalar(0.7).getHexString();
    const specs: [string, number, number, number, number][] = [
      [s.color2, 0.36, -0.26, 0.06, -0.2],
      [mid, 0.18, -0.03, 0.03, -0.1],
      [s.color, 0, 0.2, 0, 0],
    ];
    for (const [c, rz, x, y, z] of specs) {
      const m = new Mesh(geo, material(s.material, c));
      m.rotation.z = rz;
      m.position.set(x, y, z);
      m.scale.setScalar(1.1);
      obj.add(m);
    }
  } else {
    const m = new Mesh(geometry(s.shape), material(s.material, s.color));
    if (s.shape === 'icosaedro' && m.material instanceof MeshStandardMaterial) m.material.flatShading = true;
    obj.add(m);
  }
  const dispose = () => {
    const geos = new Set<BufferGeometry>();
    scene.traverse((o) => {
      if (o instanceof Mesh) {
        geos.add(o.geometry);
        (o.material as Material).dispose();
      }
    });
    geos.forEach((g) => g.dispose());
  };
  return { scene, tilt, obj, dispose };
}

type Built = ReturnType<typeof build>;

function frame(b: Built, camera: PerspectiveCamera, s: Scene3D, w: number, h: number, spin: number, floatT: number, tx: number, ty: number) {
  camera.aspect = w / h;
  // Distância que faz a esfera que contém o objeto caber na menor dimensão; o zoom aproxima a partir daí.
  const half = Math.atan(Math.tan(rad(camera.fov) / 2) * Math.min(1, camera.aspect));
  camera.position.set(0, 0, (s.parts?.length ? 1.15 : s.shape === 'cartoes' ? 1.4 : 1.3) / Math.sin(half) / s.zoom);
  camera.updateProjectionMatrix();
  b.obj.rotation.set(rad(s.rotX), rad(s.rotY) + spin, rad(s.rotZ));
  b.obj.position.y = s.float ? Math.sin(floatT * 1.6) * 0.07 : 0;
  b.tilt.rotation.set(tx, ty, 0);
}

/** Renderer com o tamanho pedido (só mexe no buffer quando muda: redimensionar apaga o desenho). */
function target(w: number, h: number) {
  const { renderer } = gl()!;
  if (sized[0] !== w || sized[1] !== h) {
    renderer.setSize(w, h, false);
    sized = [w, h];
  }
  return renderer;
}

type Inst = {
  node: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  s: Scene3D;
  b: Built;
  camera: PerspectiveCamera;
  visible: boolean;
  dirty: boolean;
  spin: number;
  t: number;
  tx: number;
  ty: number;
  gx: number;
  gy: number;
  still: boolean;
};

const insts = new Set<Inst>();
let raf = 0;
let last = 0;

function animating(i: Inst) {
  return !i.still && (i.s.spin !== 0 || i.s.float || Math.abs(i.gx - i.tx) > 1e-3 || Math.abs(i.gy - i.ty) > 1e-3);
}

function draw(i: Inst) {
  const cw = i.node.clientWidth;
  const ch = i.node.clientHeight;
  if (!cw || !ch) return;
  // Escala real na tela (zoom do editor, ajuste do fit.js) × densidade de pixels, para ficar nítido.
  const k = (i.node.getBoundingClientRect().width / cw || 1) * (i.node.ownerDocument.defaultView?.devicePixelRatio || 1);
  const f = Math.min(1, 2048 / Math.max(cw * k, ch * k));
  const w = Math.max(1, Math.round(cw * k * f));
  const h = Math.max(1, Math.round(ch * k * f));
  if (i.canvas.width !== w || i.canvas.height !== h) {
    i.canvas.width = w;
    i.canvas.height = h;
  }
  const renderer = target(w, h);
  frame(i.b, i.camera, i.s, w, h, i.spin, i.t, i.tx, i.ty);
  renderer.render(i.b.scene, i.camera);
  i.ctx.clearRect(0, 0, w, h);
  i.ctx.drawImage(renderer.domElement, 0, 0, w, h);
}

function tick(now: number) {
  raf = 0;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let again = false;
  for (const i of insts) {
    if (!i.visible) continue;
    if (animating(i)) {
      i.spin += rad(i.s.spin) * dt;
      i.t += dt;
      const e = Math.min(1, dt * 8);
      i.tx += (i.gx - i.tx) * e;
      i.ty += (i.gy - i.ty) * e;
      i.dirty = true;
    }
    if (i.dirty) {
      i.dirty = false;
      draw(i);
    }
    again ||= animating(i);
  }
  if (again) raf = requestAnimationFrame(tick);
}

function wake() {
  if (raf || !insts.size) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

const MAX_TILT = rad(15);

/**
 * Desenha a cena dentro de `node` (um canvas por elemento, um renderer para todos). O fundo é transparente:
 * quem dá a cor de fundo é o próprio elemento. Só gasta quadro quando visível e quando algo se move.
 */
export function mount3d(node: HTMLElement, scene: Scene3D): { update(scene: Scene3D): void; destroy(): void } {
  const win = node.ownerDocument.defaultView;
  if (!win || !gl()) return { update() {}, destroy() {} };
  const canvas = node.ownerDocument.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
  node.append(canvas);
  const i: Inst = {
    node, canvas, ctx: canvas.getContext('2d')!, s: scene, b: build(scene), camera: new PerspectiveCamera(32, 1, 0.1, 100),
    visible: !win.IntersectionObserver, dirty: true, spin: 0, t: 0, tx: 0, ty: 0, gx: 0, gy: 0,
    still: win.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  insts.add(i);
  const redraw = () => {
    i.dirty = true;
    wake();
  };
  const io = win.IntersectionObserver
    ? new win.IntersectionObserver(([e]) => {
        i.visible = e.isIntersecting;
        if (i.visible) redraw();
      }, { rootMargin: '120px' })
    : null;
  io?.observe(node);
  const ro = new win.ResizeObserver(redraw);
  ro.observe(node);
  const move = (e: PointerEvent) => {
    if (!i.s.pointer || i.still) return;
    const r = node.getBoundingClientRect();
    i.gy = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)) * MAX_TILT;
    i.gx = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)) * MAX_TILT;
    wake();
  };
  const leave = () => {
    i.gx = i.gy = 0;
    wake();
  };
  node.addEventListener('pointermove', move, { passive: true });
  node.addEventListener('pointerleave', leave);
  wake();
  return {
    update(next) {
      if (looks(next) !== looks(i.s)) {
        i.b.dispose();
        i.b = build(next);
      }
      i.s = next;
      redraw();
    },
    destroy() {
      insts.delete(i);
      io?.disconnect();
      ro.disconnect();
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
      i.b.dispose();
      canvas.remove();
    },
  };
}

const shots = new Map<string, string>();

/** Imagem estática (data URL PNG) da cena, para miniaturas. Guarda as últimas por parâmetros e tamanho. */
export async function snapshot3d(scene: Scene3D, w: number, h: number): Promise<string> {
  w = Math.max(1, Math.min(2048, Math.round(w)));
  h = Math.max(1, Math.min(2048, Math.round(h)));
  const key = `${JSON.stringify(scene)}@${w}x${h}`;
  const hit = shots.get(key);
  if (hit) return hit;
  if (!gl()) return '';
  const b = build(scene);
  const camera = new PerspectiveCamera(32, 1, 0.1, 100);
  const renderer = target(w, h);
  frame(b, camera, scene, w, h, 0, 0, 0, 0);
  renderer.render(b.scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  b.dispose();
  if (shots.size >= 60) shots.delete(shots.keys().next().value!);
  shots.set(key, url);
  return url;
}
