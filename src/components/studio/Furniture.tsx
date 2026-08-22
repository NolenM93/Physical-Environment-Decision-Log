'use client';

/**
 * Procedural furniture.
 *
 * A photo gives us a bounding box and a category, not a mesh. Rather than
 * render everything as a grey cuboid — which makes judging a layout genuinely
 * harder, because you cannot tell which way a sofa faces — each category is
 * assembled from primitives, parameterised by the measured dimensions. The
 * front of every piece points along local +Z, which is what the constraint
 * engine assumes too.
 */

import { useMemo } from 'react';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { FurnitureCategory } from '@/lib/domain/types';

export interface FurnitureProps {
  category: FurnitureCategory;
  width: number;
  height: number;
  depth: number;
  color: string;
  selected?: boolean;
  faded?: boolean;
}

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return `#${c.getHexString()}`;
}

function Mat({ color, faded, rough = 0.72 }: { color: string; faded?: boolean; rough?: number }) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={rough}
      metalness={0.04}
      transparent={faded}
      opacity={faded ? 0.28 : 1}
    />
  );
}

/** Small helper so every part is a soft-edged box without repeating props. */
function Part({
  size,
  position,
  color,
  faded,
  radius,
  rotation,
}: {
  size: [number, number, number];
  position: [number, number, number];
  color: string;
  faded?: boolean;
  radius?: number;
  rotation?: [number, number, number];
}) {
  const r = Math.max(0.002, Math.min(radius ?? 0.02, Math.min(...size) * 0.32));
  return (
    <RoundedBox args={size} radius={r} smoothness={2} position={position} rotation={rotation} castShadow receiveShadow>
      <Mat color={color} faded={faded} />
    </RoundedBox>
  );
}

function Legs({
  width,
  depth,
  height,
  color,
  faded,
  inset = 0.07,
  thickness = 0.05,
}: {
  width: number;
  depth: number;
  height: number;
  color: string;
  faded?: boolean;
  inset?: number;
  thickness?: number;
}) {
  const x = width / 2 - inset;
  const z = depth / 2 - inset;
  return (
    <>
      {[
        [-x, -z],
        [x, -z],
        [-x, z],
        [x, z],
      ].map(([px, pz], i) => (
        <Part
          key={i}
          size={[thickness, height, thickness]}
          position={[px, height / 2, pz]}
          color={color}
          faded={faded}
          radius={0.008}
        />
      ))}
    </>
  );
}

function Sofa({ width, height, depth, color, faded, sectional }: FurnitureProps & { sectional?: boolean }) {
  const armW = Math.min(0.22, width * 0.12);
  const seatH = height * 0.46;
  const backT = Math.min(0.18, depth * 0.22);
  const cushions = Math.max(1, Math.round((width - armW * 2) / 0.72));
  const cushionW = (width - armW * 2 - 0.03 * (cushions - 1)) / cushions;
  const light = shade(color, 0.07);
  const dark = shade(color, -0.09);

  return (
    <group>
      {/* plinth */}
      <Part size={[width, seatH * 0.6, depth]} position={[0, seatH * 0.3, 0]} color={dark} faded={faded} radius={0.03} />
      {/* seat cushions */}
      {Array.from({ length: cushions }).map((_, i) => (
        <Part
          key={i}
          size={[cushionW, seatH * 0.42, depth - backT - 0.04]}
          position={[
            -width / 2 + armW + cushionW / 2 + i * (cushionW + 0.03),
            seatH * 0.6 + seatH * 0.21,
            (backT - 0.04) / 2,
          ]}
          color={light}
          faded={faded}
          radius={0.05}
        />
      ))}
      {/* back */}
      <Part
        size={[width, height - seatH * 0.6, backT]}
        position={[0, seatH * 0.6 + (height - seatH * 0.6) / 2, -depth / 2 + backT / 2]}
        color={color}
        faded={faded}
        radius={0.04}
      />
      {/* arms */}
      {[-1, 1].map((s) => (
        <Part
          key={s}
          size={[armW, height * 0.78, depth]}
          position={[(s * (width - armW)) / 2, (height * 0.78) / 2, 0]}
          color={color}
          faded={faded}
          radius={0.05}
        />
      ))}
      {sectional && (
        <Part
          size={[depth * 0.95, height * 0.72, depth * 0.9]}
          position={[width / 2 - depth * 0.48, (height * 0.72) / 2, depth / 2 + depth * 0.42]}
          color={light}
          faded={faded}
          radius={0.05}
        />
      )}
    </group>
  );
}

function Chair({ width, height, depth, color, faded, arms }: FurnitureProps & { arms?: boolean }) {
  const seatH = Math.min(0.45, height * 0.48);
  const dark = shade(color, -0.12);
  return (
    <group>
      <Legs width={width} depth={depth} height={seatH - 0.06} color={dark} faded={faded} inset={0.06} thickness={0.04} />
      <Part size={[width, 0.09, depth]} position={[0, seatH, 0]} color={color} faded={faded} radius={0.03} />
      <Part
        size={[width * 0.92, height - seatH, 0.07]}
        position={[0, seatH + (height - seatH) / 2, -depth / 2 + 0.05]}
        color={color}
        faded={faded}
        radius={0.03}
      />
      {arms &&
        [-1, 1].map((s) => (
          <Part
            key={s}
            size={[0.07, height * 0.55, depth * 0.85]}
            position={[(s * (width - 0.07)) / 2, seatH + (height * 0.55) / 2 - 0.06, 0]}
            color={color}
            faded={faded}
            radius={0.03}
          />
        ))}
    </group>
  );
}

function Table({ width, height, depth, color, faded, thickness = 0.05 }: FurnitureProps & { thickness?: number }) {
  const dark = shade(color, -0.14);
  return (
    <group>
      <Legs width={width} depth={depth} height={height - thickness} color={dark} faded={faded} />
      <Part size={[width, thickness, depth]} position={[0, height - thickness / 2, 0]} color={color} faded={faded} radius={0.015} />
    </group>
  );
}

function Bed({ width, height, depth, color, faded, crib }: FurnitureProps & { crib?: boolean }) {
  const frameH = Math.min(0.3, height * 0.45);
  const mattressH = Math.min(0.28, height * 0.4);
  const dark = shade(color, -0.16);
  const light = shade(color, 0.22);
  return (
    <group>
      <Part size={[width, frameH, depth]} position={[0, frameH / 2, 0]} color={dark} faded={faded} radius={0.02} />
      <Part
        size={[width - 0.06, mattressH, depth - 0.06]}
        position={[0, frameH + mattressH / 2, 0]}
        color={light}
        faded={faded}
        radius={0.05}
      />
      {/* headboard at the back (local -Z) */}
      <Part
        size={[width, height, 0.06]}
        position={[0, height / 2, -depth / 2 + 0.03]}
        color={color}
        faded={faded}
        radius={0.02}
      />
      {!crib &&
        (width > 1.25 ? [-1, 1] : [0]).map((s, i) => (
          <Part
            key={i}
            size={[Math.min(0.6, width * 0.42), 0.11, 0.34]}
            position={[s * width * 0.22, frameH + mattressH + 0.05, -depth / 2 + 0.28]}
            color={shade(light, 0.08)}
            faded={faded}
            radius={0.05}
          />
        ))}
      {crib &&
        [-1, 1].map((s) => (
          <Part
            key={s}
            size={[0.05, height, depth]}
            position={[(s * (width - 0.05)) / 2, height / 2, 0]}
            color={color}
            faded={faded}
            radius={0.02}
          />
        ))}
    </group>
  );
}

function Shelving({ width, height, depth, color, faded }: FurnitureProps) {
  const shelves = Math.max(2, Math.round(height / 0.36));
  const t = 0.028;
  const dark = shade(color, -0.2);
  return (
    <group>
      <Part size={[width, height, t]} position={[0, height / 2, -depth / 2 + t / 2]} color={dark} faded={faded} radius={0.004} />
      {[-1, 1].map((s) => (
        <Part
          key={s}
          size={[t, height, depth]}
          position={[(s * (width - t)) / 2, height / 2, 0]}
          color={color}
          faded={faded}
          radius={0.004}
        />
      ))}
      {Array.from({ length: shelves + 1 }).map((_, i) => (
        <Part
          key={i}
          size={[width - t * 2, t, depth]}
          position={[0, (i * (height - t)) / shelves + t / 2, 0]}
          color={color}
          faded={faded}
          radius={0.004}
        />
      ))}
    </group>
  );
}

function Cabinet({ width, height, depth, color, faded, drawers = 3 }: FurnitureProps & { drawers?: number }) {
  const dark = shade(color, -0.18);
  const light = shade(color, 0.06);
  const rows = Math.max(1, drawers);
  const rowH = (height - 0.1) / rows;
  return (
    <group>
      <Part size={[width, height, depth]} position={[0, height / 2, 0]} color={color} faded={faded} radius={0.012} />
      {Array.from({ length: rows }).map((_, i) => (
        <group key={i}>
          <Part
            size={[width - 0.07, rowH - 0.02, 0.015]}
            position={[0, 0.06 + rowH * i + rowH / 2, depth / 2 + 0.008]}
            color={light}
            faded={faded}
            radius={0.006}
          />
          <Part
            size={[width * 0.28, 0.014, 0.022]}
            position={[0, 0.06 + rowH * i + rowH / 2, depth / 2 + 0.022]}
            color={dark}
            faded={faded}
            radius={0.006}
          />
        </group>
      ))}
      <Part size={[width, 0.06, depth]} position={[0, 0.03, 0]} color={dark} faded={faded} radius={0.01} />
    </group>
  );
}

function Screen({ width, height, depth, color, faded }: FurnitureProps) {
  const bezel = 0.018;
  return (
    <group>
      <Part size={[width, height, Math.max(0.03, depth)]} position={[0, height / 2, 0]} color="#15171b" faded={faded} radius={0.006} />
      <mesh position={[0, height / 2, Math.max(0.03, depth) / 2 + 0.002]}>
        <planeGeometry args={[width - bezel * 2, height - bezel * 2]} />
        <meshStandardMaterial
          color={color}
          roughness={0.16}
          metalness={0.5}
          emissive="#0b1622"
          emissiveIntensity={0.5}
          transparent={faded}
          opacity={faded ? 0.3 : 1}
        />
      </mesh>
    </group>
  );
}

function Lamp({ width, height, color, faded }: FurnitureProps) {
  const shadeH = Math.min(0.32, height * 0.22);
  const baseR = Math.max(0.08, width * 0.32);
  return (
    <group>
      <mesh position={[0, 0.015, 0]} castShadow>
        <cylinderGeometry args={[baseR, baseR, 0.03, 20]} />
        <Mat color={shade(color, -0.3)} faded={faded} />
      </mesh>
      <mesh position={[0, height / 2, 0]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, height - shadeH, 10]} />
        <Mat color={shade(color, -0.24)} faded={faded} />
      </mesh>
      <mesh position={[0, height - shadeH / 2, 0]} castShadow>
        <cylinderGeometry args={[width * 0.34, width * 0.5, shadeH, 22, 1, true]} />
        <meshStandardMaterial
          color={color}
          roughness={0.85}
          side={THREE.DoubleSide}
          emissive={color}
          emissiveIntensity={0.28}
          transparent={faded}
          opacity={faded ? 0.3 : 1}
        />
      </mesh>
    </group>
  );
}

function Plant({ width, height, color, faded }: FurnitureProps) {
  const potH = Math.min(0.34, height * 0.26);
  const potR = width * 0.34;
  const blobs = useMemo(() => {
    const out: [number, number, number, number][] = [];
    const count = 7;
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const angle = t * Math.PI * 2 * 1.6;
      const radius = width * 0.3 * (0.55 + 0.45 * Math.sin(t * 3.1));
      out.push([
        Math.cos(angle) * radius,
        potH + (height - potH) * (0.35 + 0.6 * t),
        Math.sin(angle) * radius,
        width * (0.2 + 0.12 * Math.sin(t * 5)),
      ]);
    }
    return out;
  }, [width, height, potH]);

  return (
    <group>
      <mesh position={[0, potH / 2, 0]} castShadow>
        <cylinderGeometry args={[potR * 0.85, potR, potH, 18]} />
        <Mat color="#8c6a52" faded={faded} />
      </mesh>
      <mesh position={[0, potH + (height - potH) * 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.03, (height - potH) * 0.75, 8]} />
        <Mat color="#6d5a3f" faded={faded} />
      </mesh>
      {blobs.map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} castShadow>
          <sphereGeometry args={[r, 12, 10]} />
          <Mat color={shade(color, i % 2 ? 0.06 : -0.06)} faded={faded} rough={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Appliance({ width, height, depth, color, faded, door = 'single' }: FurnitureProps & { door?: 'single' | 'double' | 'round' }) {
  const dark = shade(color, -0.22);
  return (
    <group>
      <Part size={[width, height, depth]} position={[0, height / 2, 0]} color={color} faded={faded} radius={0.02} />
      {door === 'double' ? (
        <>
          <Part size={[width - 0.04, height * 0.62 - 0.02, 0.02]} position={[0, height * 0.68, depth / 2 + 0.01]} color={dark} faded={faded} radius={0.008} />
          <Part size={[width - 0.04, height * 0.36 - 0.02, 0.02]} position={[0, height * 0.19, depth / 2 + 0.01]} color={dark} faded={faded} radius={0.008} />
        </>
      ) : door === 'round' ? (
        <mesh position={[0, height * 0.58, depth / 2 + 0.012]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[Math.min(width, height) * 0.3, Math.min(width, height) * 0.3, 0.02, 24]} />
          <Mat color="#2c3138" faded={faded} />
        </mesh>
      ) : (
        <Part size={[width - 0.05, height - 0.08, 0.02]} position={[0, height / 2, depth / 2 + 0.01]} color={dark} faded={faded} radius={0.008} />
      )}
      <Part size={[width * 0.06, height * 0.5, 0.03]} position={[width * 0.36, height * 0.55, depth / 2 + 0.03]} color="#c3c8ce" faded={faded} radius={0.01} />
    </group>
  );
}

function Rug({ width, depth, color, faded }: FurnitureProps) {
  return (
    <group>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={color} roughness={0.98} transparent={faded} opacity={faded ? 0.25 : 1} />
      </mesh>
      <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.min(width, depth) * 0.34, Math.min(width, depth) * 0.4, 40]} />
        <meshStandardMaterial color={shade(color, -0.12)} roughness={1} transparent opacity={faded ? 0.2 : 0.75} />
      </mesh>
    </group>
  );
}

function Generic({ width, height, depth, color, faded }: FurnitureProps) {
  return <Part size={[width, height, depth]} position={[0, height / 2, 0]} color={color} faded={faded} radius={0.02} />;
}

export function Furniture(props: FurnitureProps) {
  const { category } = props;
  switch (category) {
    case 'sofa':
      return <Sofa {...props} />;
    case 'sectional':
      return <Sofa {...props} sectional />;
    case 'armchair':
      return <Chair {...props} arms />;
    case 'dining_chair':
      return <Chair {...props} />;
    case 'office_chair':
      return <Chair {...props} arms />;
    case 'coffee_table':
      return <Table {...props} thickness={0.04} />;
    case 'dining_table':
      return <Table {...props} thickness={0.05} />;
    case 'side_table':
    case 'nightstand':
      return props.category === 'nightstand' ? <Cabinet {...props} drawers={2} /> : <Table {...props} thickness={0.035} />;
    case 'desk':
      return <Table {...props} thickness={0.04} />;
    case 'console':
      return <Cabinet {...props} drawers={2} />;
    case 'bed':
      return <Bed {...props} />;
    case 'crib':
      return <Bed {...props} crib />;
    case 'dresser':
      return <Cabinet {...props} drawers={4} />;
    case 'wardrobe':
      return <Cabinet {...props} drawers={2} />;
    case 'bookshelf':
      return <Shelving {...props} />;
    case 'media_unit':
      return <Cabinet {...props} drawers={2} />;
    case 'tv':
      return <Screen {...props} />;
    case 'rug':
      return <Rug {...props} />;
    case 'floor_lamp':
    case 'table_lamp':
      return <Lamp {...props} />;
    case 'plant':
      return <Plant {...props} />;
    case 'refrigerator':
      return <Appliance {...props} door="double" />;
    case 'washer_dryer':
    case 'dishwasher':
      return <Appliance {...props} door="round" />;
    case 'range':
      return <Appliance {...props} />;
    case 'counter':
    case 'island':
      return <Cabinet {...props} drawers={3} />;
    case 'ottoman':
      return <Part size={[props.width, props.height, props.depth]} position={[0, props.height / 2, 0]} color={props.color} faded={props.faded} radius={0.06} />;
    default:
      return <Generic {...props} />;
  }
}
