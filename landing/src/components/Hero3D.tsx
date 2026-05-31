import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';

function getThemeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    bg: s.getPropertyValue('--bg').trim(),
    bgSoft: s.getPropertyValue('--bg-soft').trim(),
    bgElevated: s.getPropertyValue('--bg-elevated').trim(),
    text: s.getPropertyValue('--text').trim(),
    text2: s.getPropertyValue('--text-2').trim(),
    text3: s.getPropertyValue('--text-3').trim(),
    accent: s.getPropertyValue('--accent').trim(),
    accentInk: s.getPropertyValue('--accent-ink').trim(),
  };
}

type ThemeColors = ReturnType<typeof getThemeColors>;
type ColorKey = keyof ThemeColors;

function parseRgb(c: string): [number, number, number] {
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    const full = hex.length === 3 ? hex.split('').map((h) => h + h).join('') : hex;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const m = c.match(/\d+/g);
  return m ? (m.slice(0, 3).map(Number) as [number, number, number]) : [0, 0, 0];
}

function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseRgb(a);
  const [r2, g2, b2] = parseRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function lerpThemeColors(from: ThemeColors, to: ThemeColors, t: number): ThemeColors {
  const keys = Object.keys(from) as ColorKey[];
  const result = {} as ThemeColors;
  for (const k of keys) result[k] = lerpColor(from[k], to[k], t);
  return result;
}

/** Reads the IDE theme CSS variables and smoothly tweens them on theme switch. */
function useThemeColors(): ThemeColors {
  const targetRef = useRef<ThemeColors>(getThemeColors());
  const currentRef = useRef<ThemeColors>(getThemeColors());
  const progressRef = useRef(1);
  const [colors, setColors] = useState<ThemeColors>(getThemeColors);

  useEffect(() => {
    const onThemeChange = () => {
      targetRef.current = getThemeColors();
      progressRef.current = 0;
    };
    const observer = new MutationObserver(onThemeChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let raf: number;
    let lastTime = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      if (progressRef.current < 1) {
        progressRef.current = Math.min(1, progressRef.current + dt / 0.6);
        const eased = 1 - Math.pow(1 - progressRef.current, 3);
        currentRef.current = lerpThemeColors(currentRef.current, targetRef.current, eased);
        setColors({ ...currentRef.current });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return colors;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ── Layout ──────────────────────────────────────────────
const EW = 3.0; // editor width
const PW = 2.7; // page width
const PH = 4.2; // panel height
const PANELX = 1.85;
const TOPBAR = 0.34;
const LINE_H = 0.255;
const SEG_GAP = 0.08;
const Z_FRONT = 0.075;

// Loop timing (fractions of one period)
const PERIOD = 9.5;
const TYPE_SPAN = 0.42;
const COMPILE_START = 0.44;
const COMPILE_END = 0.6;
const RENDER_START = 0.52;
const RENDER_SPAN = 0.36;

// ── Source code (left panel), as syntax-colored segments ──
// each line: { indent, segs: [width, colorKey][] }
type Line = { indent: number; segs: [number, ColorKey][] };
const CODE: Line[] = [
  { indent: 0, segs: [[0.95, 'accent'], [0.5, 'text2']] }, // \documentclass{article}
  { indent: 0, segs: [[0.8, 'accent'], [0.7, 'text2']] },  // \usepackage{...}
  { indent: 0, segs: [[0.55, 'accentInk'], [0.62, 'text']] }, // \name{Jayden Tan}
  { indent: 0, segs: [[0.66, 'accent'], [0.72, 'text2']] }, // \section{Experience}
  { indent: 0.18, segs: [[0.45, 'accentInk'], [0.9, 'text']] }, // \item ...
  { indent: 0.36, segs: [[1.05, 'text']] },
  { indent: 0.18, segs: [[0.45, 'accentInk'], [0.8, 'text']] },
  { indent: 0.36, segs: [[0.92, 'text']] },
  { indent: 0, segs: [[0.66, 'accent'], [0.66, 'text2']] }, // \section{Education}
  { indent: 0.18, segs: [[0.45, 'accentInk'], [0.86, 'text']] },
  { indent: 0, segs: [[0.66, 'accent'], [0.5, 'text2']] }, // \section{Skills}
  { indent: 0.18, segs: [[1.18, 'text3']] },
];

// ── Rendered page (right panel) lines: { width, colorKey, headerIdx? } ──
type PageRow =
  | { kind: 'bar'; w: number; key: ColorKey; h?: number }
  | { kind: 'gap'; h: number }
  | { kind: 'header'; label: string }
  | { kind: 'rule' };

const PAGE: PageRow[] = [
  { kind: 'gap', h: 0.05 },
  { kind: 'gap', h: 0.25 }, // space reserved for the name (rendered separately as Text)
  { kind: 'bar', w: 1.5, key: 'text3', h: 0.05 }, // contact line
  { kind: 'gap', h: 0.12 },
  { kind: 'header', label: 'EXPERIENCE' },
  { kind: 'bar', w: 1.9, key: 'text2' },
  { kind: 'bar', w: 1.7, key: 'text2' },
  { kind: 'bar', w: 1.95, key: 'text2' },
  { kind: 'gap', h: 0.1 },
  { kind: 'header', label: 'EDUCATION' },
  { kind: 'bar', w: 1.8, key: 'text2' },
  { kind: 'bar', w: 1.55, key: 'text2' },
  { kind: 'gap', h: 0.1 },
  { kind: 'header', label: 'SKILLS' },
  { kind: 'bar', w: 1.95, key: 'text3' },
];

type Seg = { x0: number; w: number; key: ColorKey; leftX: number; y: number; li: number };

function Scene({ colors, mouse }: { colors: ThemeColors; mouse: React.RefObject<{ x: number; y: number }> }) {
  const root = useRef<THREE.Group>(null);
  const smooth = useRef({ x: 0, y: 0 });

  const codeRefs = useRef<THREE.Mesh[]>([]);
  const cursorRef = useRef<THREE.Mesh>(null);
  const scanRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const pageRefs = useRef<THREE.Mesh[]>([]);
  // troika Text instances: `.color` is a plain color value (assign a string), `.fillOpacity` a number.
  const headerRefs = useRef<Array<{ fillOpacity: number; color: string } | null>>([]);
  const nameRef = useRef<{ fillOpacity: number; color: string } | null>(null);
  const fileRef = useRef<{ fillOpacity: number; color: string } | null>(null);
  const badgeRef = useRef<THREE.Mesh>(null);

  const unit = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0.5, 0, 0); // left-anchored: grows rightward from its x
    return g;
  }, []);
  useEffect(() => () => unit.dispose(), [unit]);

  // Flatten code into positioned colored segments + per-line totals/thresholds.
  const { segs, lineTotal } = useMemo(() => {
    const segs: Seg[] = [];
    const lineTotal: number[] = [];
    const contentLeft = -EW / 2 + 0.26;
    const contentTop = PH / 2 - TOPBAR - 0.28;
    CODE.forEach((ln, li) => {
      let cx = 0;
      const leftX = contentLeft + ln.indent;
      const y = contentTop - li * LINE_H;
      ln.segs.forEach(([w, key]) => {
        segs.push({ x0: cx, w, key, leftX, y, li });
        cx += w + SEG_GAP;
      });
      lineTotal[li] = cx - SEG_GAP;
    });
    return { segs, lineTotal };
  }, []);

  // Page rows resolved to y-positions (top to bottom).
  const pageRows = useMemo(() => {
    const margin = 0.34;
    const top = PH / 2 - margin;
    const leftX = -PW / 2 + margin;
    let y = top;
    const rows: Array<{ row: PageRow; y: number; leftX: number; barIdx?: number; headerIdx?: number }> = [];
    let barIdx = 0;
    let headerIdx = 0;
    for (const row of PAGE) {
      if (row.kind === 'gap') { y -= row.h; continue; }
      if (row.kind === 'rule') { rows.push({ row, y, leftX }); y -= 0.12; continue; }
      if (row.kind === 'header') { rows.push({ row, y, leftX, headerIdx: headerIdx++ }); y -= 0.26; continue; }
      rows.push({ row, y, leftX, barIdx: barIdx++ });
      y -= (row.h ?? 0.05) + 0.13;
    }
    return rows;
  }, []);

  const revealOrder = pageRows.filter((r) => r.row.kind === 'bar' || r.row.kind === 'header');

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const p = (t % PERIOD) / PERIOD;

    // global fade (hides the loop reset)
    let fade = 1;
    if (p < 0.04) fade = p / 0.04;
    else if (p > 0.93) fade = (1 - p) / 0.07;
    fade = clamp01(fade);

    const c = (k: ColorKey) => colors[k];

    // ── editor code typing ──
    let activeLine = 0;
    let activeChars = 0;
    let activeLeftX = 0;
    let activeY = 0;
    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s];
      const mesh = codeRefs.current[s];
      if (!mesh) continue;
      const lineStart = (seg.li / CODE.length) * (TYPE_SPAN * 0.8);
      const linePer = TYPE_SPAN * 0.34;
      const rLine = clamp01((p - lineStart) / linePer);
      const chars = rLine * lineTotal[seg.li];
      const segR = clamp01((chars - seg.x0) / seg.w);
      mesh.scale.set(Math.max(0.0001, seg.w * segR), 0.07, 1);
      mesh.position.set(seg.leftX + seg.x0, seg.y, Z_FRONT);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(c(seg.key));
      mat.opacity = fade * clamp01(segR * 5);

      if (p < TYPE_SPAN) {
        const lf = clamp01((p - lineStart) / linePer);
        if (lf > 0 && lf < 1) { activeLine = seg.li; activeChars = chars; activeLeftX = seg.leftX; activeY = seg.y; }
      }
    }

    // typing cursor
    if (cursorRef.current) {
      const blink = Math.sin(t * 9) > 0;
      const show = p < TYPE_SPAN && blink;
      cursorRef.current.visible = show && fade > 0.4;
      cursorRef.current.position.set(activeLeftX + activeChars + 0.03, activeY, Z_FRONT);
      (cursorRef.current.material as THREE.MeshBasicMaterial).color.set(c('accent'));
      void activeLine;
    }

    // ── compile sweep + connector pulse ──
    const inCompile = p >= COMPILE_START && p <= COMPILE_END;
    const cp = clamp01((p - COMPILE_START) / (COMPILE_END - COMPILE_START));
    if (scanRef.current) {
      scanRef.current.visible = inCompile;
      const topY = PH / 2 - TOPBAR - 0.05;
      const usable = PH - TOPBAR - 0.2;
      scanRef.current.position.set(0, topY - cp * usable, Z_FRONT + 0.01);
      (scanRef.current.material as THREE.MeshBasicMaterial).color.set(c('accent'));
      (scanRef.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.5 * Math.sin(cp * Math.PI);
    }
    // connector beam + pulse live in root space (between panels)
    const beamX0 = -PANELX + EW / 2 - 0.12;
    const beamX1 = PANELX - PW / 2 + 0.12;
    if (beamRef.current) {
      beamRef.current.visible = inCompile || (p > COMPILE_START && p < RENDER_START + 0.1);
      beamRef.current.position.set((beamX0 + beamX1) / 2, 0, 0.02);
      beamRef.current.scale.set(beamX1 - beamX0, 0.012, 1);
      (beamRef.current.material as THREE.MeshBasicMaterial).color.set(c('accent'));
      (beamRef.current.material as THREE.MeshBasicMaterial).opacity = fade * (inCompile ? 0.5 : 0.0);
    }
    if (pulseRef.current) {
      pulseRef.current.visible = inCompile;
      pulseRef.current.position.set(beamX0 + (beamX1 - beamX0) * cp, 0, 0.04);
      const sc = 0.12 + 0.05 * Math.sin(cp * Math.PI);
      pulseRef.current.scale.set(sc, sc, 1);
      (pulseRef.current.material as THREE.MeshBasicMaterial).color.set(c('accentInk'));
      (pulseRef.current.material as THREE.MeshBasicMaterial).opacity = fade * Math.sin(cp * Math.PI);
    }

    // ── page render ──
    const total = revealOrder.length;
    revealOrder.forEach((entry, idx) => {
      const start = RENDER_START + (idx / total) * (RENDER_SPAN * 0.85);
      const r = clamp01((p - start) / (RENDER_SPAN * 0.22));
      if (entry.row.kind === 'bar') {
        const mesh = pageRefs.current[entry.barIdx!];
        if (!mesh) return;
        const w = entry.row.w;
        const h = entry.row.h ?? 0.05;
        mesh.scale.set(Math.max(0.0001, w * r), h, 1);
        mesh.position.set(entry.leftX, entry.y, Z_FRONT);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.color.set(c(entry.row.key));
        mat.opacity = fade * clamp01(r * 5);
      } else if (entry.row.kind === 'header') {
        const h = headerRefs.current[entry.headerIdx!];
        if (h) { h.fillOpacity = fade * r; h.color = c('accent'); }
      }
    });

    // name + filename labels
    if (nameRef.current) {
      const r = clamp01((p - (RENDER_START - 0.02)) / (RENDER_SPAN * 0.2));
      nameRef.current.fillOpacity = fade * r;
      nameRef.current.color = c('text');
    }
    if (fileRef.current) {
      fileRef.current.fillOpacity = fade * clamp01(p / 0.06);
      fileRef.current.color = c('text2');
    }
    // "Compiled" badge dot pulses in after compile
    if (badgeRef.current) {
      const show = p > COMPILE_END - 0.02;
      badgeRef.current.visible = show;
      (badgeRef.current.material as THREE.MeshBasicMaterial).color.set(c('accent'));
      (badgeRef.current.material as THREE.MeshBasicMaterial).opacity = fade * (show ? 0.9 : 0);
    }

    // ── parallax + idle float ──
    const target = mouse.current ?? { x: 0, y: 0 };
    smooth.current.x += (target.x - smooth.current.x) * 0.045;
    smooth.current.y += (target.y - smooth.current.y) * 0.045;
    if (root.current) {
      root.current.rotation.y = smooth.current.x * 0.18 + Math.sin(t * 0.25) * 0.02;
      root.current.rotation.x = -smooth.current.y * 0.12;
      root.current.position.y = Math.sin(t * 0.5) * 0.04;
    }
  });

  let segIndex = 0;
  let barIndex = 0;
  let headerIndex = 0;

  return (
    <group ref={root}>
      {/* ── Editor panel ── */}
      <group position={[-PANELX, 0, 0]} rotation={[0, 0.1, 0]}>
        <RoundedBox args={[EW, PH, 0.12]} radius={0.07} smoothness={4}>
          <meshStandardMaterial color={colors.bg} roughness={0.9} metalness={0} />
        </RoundedBox>
        {/* top bar */}
        <mesh position={[0, PH / 2 - TOPBAR / 2 - 0.02, 0.05]}>
          <planeGeometry args={[EW - 0.08, TOPBAR]} />
          <meshBasicMaterial color={colors.bgElevated} transparent opacity={0.95} toneMapped={false} />
        </mesh>
        {[['#ff5f57', 0], ['#ffbd2e', 1], ['#28c840', 2]].map(([col, i]) => (
          <mesh key={i as number} position={[-EW / 2 + 0.24 + (i as number) * 0.18, PH / 2 - TOPBAR / 2 - 0.02, 0.06]}>
            <circleGeometry args={[0.045, 16]} />
            <meshBasicMaterial color={col as string} toneMapped={false} />
          </mesh>
        ))}
        <Text
          ref={fileRef as never}
          position={[-EW / 2 + 0.95, PH / 2 - TOPBAR / 2 - 0.02, 0.06]}
          fontSize={0.13}
          anchorX="left"
          anchorY="middle"
          fillOpacity={0}
        >
          resume.tex
        </Text>

        {/* code segments */}
        {CODE.map((ln, li) =>
          ln.segs.map((_, k) => {
            const i = segIndex++;
            return (
              <mesh
                key={`c${li}-${k}`}
                ref={(m) => { if (m) codeRefs.current[i] = m; }}
                geometry={unit}
              >
                <meshBasicMaterial transparent depthWrite={false} opacity={0} toneMapped={false} />
              </mesh>
            );
          })
        )}

        {/* typing cursor */}
        <mesh ref={cursorRef}>
          <planeGeometry args={[0.025, 0.16]} />
          <meshBasicMaterial transparent toneMapped={false} />
        </mesh>

        {/* compile scan line */}
        <mesh ref={scanRef}>
          <planeGeometry args={[EW - 0.1, 0.03]} />
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
        </mesh>
      </group>

      {/* ── Page panel ── */}
      <group position={[PANELX, 0, 0]} rotation={[0, -0.1, 0]}>
        <RoundedBox args={[PW, PH, 0.12]} radius={0.07} smoothness={4}>
          <meshStandardMaterial color={colors.bgElevated} roughness={0.85} metalness={0} />
        </RoundedBox>
        {/* name */}
        <Text
          ref={nameRef as never}
          position={[-PW / 2 + 0.34, PH / 2 - 0.42, 0.06]}
          fontSize={0.2}
          anchorX="left"
          anchorY="middle"
          fontWeight={700 as never}
          fillOpacity={0}
          letterSpacing={0.02}
        >
          Alex Rivera
        </Text>
        {/* compiled badge dot */}
        <mesh ref={badgeRef} position={[PW / 2 - 0.3, PH / 2 - 0.42, 0.06]}>
          <circleGeometry args={[0.05, 20]} />
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
        </mesh>

        {pageRows.map((entry, idx) => {
          if (entry.row.kind === 'bar') {
            const i = barIndex++;
            return (
              <mesh
                key={`p${idx}`}
                ref={(m) => { if (m) pageRefs.current[i] = m; }}
                geometry={unit}
              >
                <meshBasicMaterial transparent depthWrite={false} opacity={0} toneMapped={false} />
              </mesh>
            );
          }
          if (entry.row.kind === 'header') {
            const hi = headerIndex++;
            return (
              <Text
                key={`p${idx}`}
                ref={((el: never) => { headerRefs.current[hi] = el; }) as never}
                position={[entry.leftX, entry.y, 0.06]}
                fontSize={0.1}
                anchorX="left"
                anchorY="middle"
                fontWeight={700 as never}
                letterSpacing={0.08}
                fillOpacity={0}
              >
                {entry.row.label}
              </Text>
            );
          }
          return null;
        })}
      </group>

      {/* ── Connector (compile beam + pulse) ── */}
      <mesh ref={beamRef}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={pulseRef}>
        <circleGeometry args={[0.5, 24]} />
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default function Hero3D() {
  const colors = useThemeColors();
  const mouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 0, 10], fov: 38 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[-3, 4, 5]} intensity={0.5} />
      <Suspense fallback={null}>
        <Scene colors={colors} mouse={mouse} />
      </Suspense>
    </Canvas>
  );
}
