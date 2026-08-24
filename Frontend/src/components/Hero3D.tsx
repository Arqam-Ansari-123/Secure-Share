import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame, type ThreeElements } from '@react-three/fiber'
import { Float, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'

import { usePrefersReducedMotion } from './ui'
import logoMark from '../../Assets/logo.png'

/**
 * The Genetech speech-bubble mark, extruded into real geometry and lit like a
 * physical object — plus the binary bars from inside the logo, broken out and
 * left orbiting around it.
 *
 * Cost control: one <Canvas>, DPR capped at 1.75, no post-processing, no
 * environment map (a CDN HDRI would violate the app's own CSP anyway). Under
 * prefers-reduced-motion the whole canvas is replaced by a static poster.
 */

/** Rounded speech-bubble outline, drawn once and memoised. */
function useBubbleGeometry() {
  return useMemo(() => {
    const w = 2.7
    const h = 2.05
    const r = 0.62
    const x = -w / 2
    const y = -h / 2

    const s = new THREE.Shape()
    s.moveTo(x + r, y)
    s.lineTo(x + w - r, y)
    s.quadraticCurveTo(x + w, y, x + w, y + r)
    s.lineTo(x + w, y + h - r)
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    s.lineTo(x + r, y + h)
    s.quadraticCurveTo(x, y + h, x, y + h - r)
    s.lineTo(x, y + r)
    s.quadraticCurveTo(x, y, x + r, y)

    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.42,
      bevelEnabled: true,
      bevelThickness: 0.09,
      bevelSize: 0.09,
      bevelSegments: 6,
      curveSegments: 24,
    })
    geo.center()
    return geo
  }, [])
}

/** The tail, as its own wedge so the outline stays a clean rounded rect. */
function useTailGeometry() {
  return useMemo(() => {
    const t = new THREE.Shape()
    t.moveTo(0, 0)
    t.lineTo(0.62, 0.5)
    t.lineTo(0.06, 0.72)
    t.lineTo(0, 0)
    const geo = new THREE.ExtrudeGeometry(t, {
      depth: 0.42,
      bevelEnabled: true,
      bevelThickness: 0.06,
      bevelSize: 0.06,
      bevelSegments: 4,
    })
    geo.center()
    return geo
  }, [])
}

/** The three slanted binary bars that sit on the face of the real logo. */
function BinaryBars() {
  const rows = [
    [-0.72, 0.42],
    [-0.72, -0.02],
    [-0.72, -0.46],
  ]
  return (
    <group position={[0, 0, 0.3]}>
      {rows.map(([bx, by], r) =>
        [0, 1, 2].map((c) => {
          const isOne = (r + c) % 2 === 0
          return (
            <mesh
              key={`${r}-${c}`}
              position={[bx + c * 0.72, by, 0]}
              rotation={[0, 0, 0.32]}
              castShadow
            >
              {isOne ? (
                <boxGeometry args={[0.13, 0.46, 0.12]} />
              ) : (
                <torusGeometry args={[0.17, 0.062, 10, 22]} />
              )}
              <meshStandardMaterial color="#f6f9fa" roughness={0.35} metalness={0.05} />
            </mesh>
          )
        }),
      )}
    </group>
  )
}

/** Group that eases toward the pointer instead of snapping to it. */
function PointerTilt(props: ThreeElements['group']) {
  const ref = useRef<THREE.Group>(null)
  useFrame((state, delta) => {
    if (!ref.current) return
    const { x, y } = state.pointer
    // damp() is frame-rate independent — a raw lerp would tilt faster on a 144Hz
    // screen than on a 60Hz one.
    ref.current.rotation.y = THREE.MathUtils.damp(ref.current.rotation.y, x * 0.55, 3, delta)
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, -y * 0.4, 3, delta)
  })
  return <group ref={ref} {...props} />
}

function Mark() {
  const bubble = useBubbleGeometry()
  const tail = useTailGeometry()
  const spin = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.z += delta * 0.06
  })

  return (
    <PointerTilt>
      <group ref={spin}>
        <mesh geometry={bubble} castShadow receiveShadow>
          <meshStandardMaterial color="#c0392b" roughness={0.28} metalness={0.22} />
        </mesh>
        <mesh geometry={tail} position={[-1.15, -1.02, 0]} rotation={[0, 0, 3.5]} castShadow>
          <meshStandardMaterial color="#c0392b" roughness={0.28} metalness={0.22} />
        </mesh>
        <BinaryBars />
      </group>
    </PointerTilt>
  )
}

/** Loose binary bits drifting around the mark. */
function Orbiters() {
  const items = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        angle: (i / 14) * Math.PI * 2,
        radius: 2.9 + (i % 4) * 0.42,
        y: ((i % 5) - 2) * 0.6,
        speed: 0.11 + (i % 3) * 0.05,
        one: i % 2 === 0,
      })),
    [],
  )
  const group = useRef<THREE.Group>(null)
  useFrame((state) => {
    if (!group.current) return
    const t = state.clock.elapsedTime
    group.current.children.forEach((child, i) => {
      const it = items[i]
      child.position.x = Math.cos(it.angle + t * it.speed) * it.radius
      child.position.z = Math.sin(it.angle + t * it.speed) * it.radius
      child.rotation.y += 0.004
    })
  })

  return (
    <group ref={group}>
      {items.map((it, i) => (
        <mesh key={i} position={[0, it.y, 0]} rotation={[0, 0, 0.3]}>
          {it.one ? (
            <boxGeometry args={[0.075, 0.28, 0.075]} />
          ) : (
            <torusGeometry args={[0.1, 0.036, 8, 16]} />
          )}
          <meshStandardMaterial
            color={i % 3 === 0 ? '#2d7ba3' : '#8aa4b3'}
            emissive={i % 3 === 0 ? '#1b4b66' : '#000000'}
            emissiveIntensity={0.5}
            roughness={0.5}
          />
        </mesh>
      ))}
    </group>
  )
}

export function Hero3D() {
  const reduced = usePrefersReducedMotion()

  // Static poster: same silhouette, zero WebGL, zero animation.
  if (reduced) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <img
          src={logoMark}
          alt="Genetech Solutions mark"
          className="w-56 drop-shadow-[0_24px_60px_rgba(192,57,43,0.45)]"
        />
      </div>
    )
  }

  return (
    <Canvas
      dpr={[1, 1.75]}
      shadows
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ width: '100%', height: '100%' }}
    >
      <PerspectiveCamera makeDefault position={[0, 0, 7.2]} fov={42} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 6, 5]} intensity={2.1} castShadow />
      <pointLight position={[-5, -2, 3]} intensity={30} color="#2d7ba3" />
      <pointLight position={[4, -3, -4]} intensity={22} color="#e2503b" />
      <Suspense fallback={null}>
        <Float speed={1.3} rotationIntensity={0.22} floatIntensity={0.55}>
          <Mark />
        </Float>
        <Orbiters />
      </Suspense>
    </Canvas>
  )
}
