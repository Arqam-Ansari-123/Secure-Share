import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, type ThreeElements } from '@react-three/fiber'
import { Float, PerspectiveCamera, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

import { usePrefersReducedMotion } from './ui'
import logoMark from '../../Assets/icon.svg'

/**
 * The Genetech speech-bubble mark as a real modelled asset, lit like a physical
 * object — plus binary bits left orbiting around it.
 *
 * The mark used to be BUILT here: a rounded rectangle drawn with THREE.Shape,
 * extruded, with a separate wedge bolted on for the tail and three slanted bars
 * laid on the face. It was an approximation of the logo and read as one. It is
 * now public/models/bubble-cut.glb — the actual artwork, tail included, with
 * the bars cut through the face.
 *
 * Cost control: one <Canvas>, DPR capped at 1.75, no post-processing, no
 * environment map (a CDN HDRI would violate the app's own CSP anyway). Under
 * prefers-reduced-motion the whole canvas is replaced by a static poster.
 */

/**
 * The mark itself.
 *
 * Two meshes ("face" and "edge") carrying their own materials, so the brand red
 * comes from the asset rather than being restated here. 2.6k triangles, 57 KB.
 *
 * Native size is 2.0 x 1.79 x 0.26 and it is already centred on the origin and
 * extruded along Z, so it needs no offset or re-orientation — only a scale, to
 * match the framing the old generated geometry had.
 *
 * glTF carries no shadow flags, so castShadow/receiveShadow have to be set on
 * the meshes after load or the mark floats with nothing under it.
 */
const MODEL = '/models/bubble-cut.glb'
const MODEL_SCALE = 1.35 // native width 2.0 -> 2.7, matching the previous mark

/**
 * Surface overrides, applied on top of the asset's own materials.
 *
 * The export ships face #C43B28 at roughness 0.42 / metalness 0, and edge
 * #96281A at 0.38 / 0.25. That face is almost exactly the brand red already,
 * but 0.42 roughness with no metalness is a MATTE surface: it scatters the key
 * light instead of catching it, so the mark reads flat and dim next to the
 * saturated headline. The generated geometry it replaced ran 0.28 / 0.22 and
 * picked up a highlight along the top edge.
 *
 * So this is two changes, not one: a heavier red, and enough gloss for the
 * lighting to actually land on it. The faint emissive stops the shadowed side
 * going muddy brown, which is what a dark red does when it falls off to black.
 *
 * All tunable — these six numbers are the whole look.
 */
const FACE = { color: '#d8402c', roughness: 0.26, metalness: 0.18, emissive: '#2e0b06' }
const EDGE = { color: '#a32a1b', roughness: 0.32, metalness: 0.3, emissive: '#1a0603' }

function BubbleModel() {
  const { scene } = useGLTF(MODEL)

  // Clone so a second mount (e.g. React strict-mode double render) cannot
  // mutate the cached original.
  const model = useMemo(() => scene.clone(true), [scene])

  useEffect(() => {
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return

      // glTF carries no shadow flags; without these the mark floats with
      // nothing under it.
      m.castShadow = true
      m.receiveShadow = true

      // Object3D.clone() does NOT deep-copy materials — they stay shared with
      // the instance useGLTF caches. Mutating them directly would leak this
      // styling into every future mount of the model.
      const src = m.material as THREE.MeshStandardMaterial
      const spec = m.name === 'edge' ? EDGE : FACE
      const mat = src.clone()
      mat.color = new THREE.Color(spec.color)
      mat.roughness = spec.roughness
      mat.metalness = spec.metalness
      mat.emissive = new THREE.Color(spec.emissive)
      m.material = mat
    })
  }, [model])

  return <primitive object={model} scale={MODEL_SCALE} />
}

useGLTF.preload(MODEL)

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
  const spin = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.z += delta * 0.06
  })

  return (
    <PointerTilt>
      <group ref={spin}>
        <BubbleModel />
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
          {/* White, matching the bars inside the logo itself (#F4F4F4) rather
              than the old navy #2d7ba3 / #8aa4b3, which read as a second accent
              colour competing with the red mark.

              The depth variation is kept, but expressed through EMISSIVE rather
              than hue: every third bit carries a faint neutral glow so it lifts
              out of the dark, while the rest are lit only by the scene. Two
              near-identical whites would have flattened the whole cloud.

              A little metalness stops white going chalky -- these read as the
              brushed silver bars from the mark, not as paper. */}
          <meshStandardMaterial
            color={i % 3 === 0 ? '#ffffff' : '#f4f4f4'}
            emissive={i % 3 === 0 ? '#5a6066' : '#000000'}
            emissiveIntensity={0.5}
            roughness={0.42}
            metalness={0.18}
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
      {/* Two rim lights, cool from the left and warm from the right, giving the
          mark its dimensionality.

          The cool one used to be brand navy #2d7ba3 -- saturated enough that it
          tinted the orbiting bits blue no matter what colour their material was.
          Now a barely-cool white: the rim shaping survives, but white geometry
          finally reads as white. The warm side stays brand red, since it lands
          on the red mark and reinforces it rather than fighting it. */}
      <pointLight position={[-5, -2, 3]} intensity={30} color="#dceaf2" />
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
