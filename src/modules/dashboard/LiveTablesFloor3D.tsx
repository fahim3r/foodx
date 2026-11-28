import { useEffect, useRef, useState, type RefObject } from 'react'

import type { OpenTableOrderSummary } from '@/services/tables'
import type { DiningTable } from '@/types'

// three.js is loaded at runtime from a CDN instead of being bundled:
// it keeps the panel bundle lean, and when the CDN or WebGL is
// unavailable the card falls back to the flat grid view. The URL is
// held in a variable on purpose — a literal would make the bundler
// (and the type checker) try to resolve it at build time.
const THREE_CDN_URL =
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'
const LOAD_TIMEOUT_MS = 9_000

const SHIRT_COLORS = [
  '#5b7fa6',
  '#c96f4a',
  '#5f8d4e',
  '#8d6fb8',
  '#b8546e',
  '#4e7d86',
]
const SKIN_COLORS = ['#eab892', '#d99e73', '#b97a56', '#8d5a3b']
const HAIR_COLORS = ['#4a3728', '#26221f', '#5d4028', '#1d1a17']

type FloorState = 'free' | 'occupied' | 'cleaning' | 'reserved'

interface TableVisual {
  table: DiningTable
  state: FloorState
  calling: boolean
  served: boolean
  status: string
  paid: boolean
}

type GuestMode = 'waiting' | 'ready' | 'eating' | 'done'

interface GuestAnim {
  root: any
  upper: any
  head: any
  armR: any
  armL: any
  eatArm: any
  restArm: any
  eatSide: number
  phase: number
}

interface BuiltTable {
  group: any
  bell: any | null
  ring: any | null
  sparkles: any | null
  mode: GuestMode
  guests: GuestAnim[]
  mainAnchor: any
  bellAnchor: any
  phase: number
}

/**
 * The Live Tables floor as a real animated 3D scene (three.js):
 * one diorama of the whole restaurant — wooden round tables with
 * chairs on a raised floor, soft shadows, a gently swaying camera.
 * Occupied tables seat two animated guests — they look around
 * while they wait, and once the order is SERVED the plates arrive
 * and they start eating (arm to mouth, nodding). A table being
 * cleaned gets a spray bottle and orbiting sparkles; a reserved
 * table gets a little sign; a pending waiter call hangs a ringing
 * golden bell over the table with a pulsing ring on the floor. The
 * state chips (table name + status) are HTML elements whose screen
 * positions this component projects every frame (the parent owns
 * the chip DOM nodes through `chipEls`). Clicking a table reports
 * its id through onSelectTable.
 */
export default function LiveTablesFloor3D({
  tables,
  openByTable,
  callingTables,
  chipEls,
  onSelectTable,
  onReady,
  onError,
}: {
  tables: DiningTable[]
  openByTable: Map<string, OpenTableOrderSummary>
  callingTables: Set<string>
  chipEls: RefObject<Map<string, HTMLElement | null>>
  onSelectTable: (tableId: string) => void
  onReady: () => void
  onError: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const threeRef = useRef<any>(null)
  const sceneRef = useRef<any>(null)
  const cameraRef = useRef<any>(null)
  const rendererRef = useRef<any>(null)
  const floorGroupRef = useRef<any>(null)
  const builtRef = useRef<BuiltTable[]>([])
  const visibleRef = useRef(true)
  const baseCamRef = useRef<{ x: number; y: number; z: number }>({
    x: 0,
    y: 10,
    z: 12,
  })
  const fitRef = useRef(1)
  const [sceneReady, setSceneReady] = useState(0)
  const selectRef = useRef(onSelectTable)
  selectRef.current = onSelectTable
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const errorRef = useRef(onError)
  errorRef.current = onError

  const visualsRef = useRef<TableVisual[]>([])
  visualsRef.current = tables.map((table) => {
    const calling = callingTables.has(table.id)
    const state: FloorState =
      table.status === 'occupied' || openByTable.has(table.id) || calling
        ? 'occupied'
        : table.status === 'cleaning'
          ? 'cleaning'
          : table.status === 'reserved'
            ? 'reserved'
            : 'free'
    const open = openByTable.get(table.id)
    const served = open?.served ?? false
    return {
      table,
      state,
      calling,
      served,
      status: open?.status ?? '',
      paid: open?.paid ?? false,
    }
  })
  const signature = visualsRef.current
    .map(
      (v) =>
        `${v.table.id}:${v.state}:${v.calling ? 1 : 0}:${v.served ? 1 : 0}:${v.status}:${v.paid ? 1 : 0}`,
    )
    .join('|')

  // ---- Scene setup (once three.js arrives) ----
  useEffect(() => {
    let cancelled = false
    let raf = 0
    let renderer: any = null
    let resizeObserver: ResizeObserver | null = null
    let intersectionObserver: IntersectionObserver | null = null

    const fail = () => {
      if (!cancelled) errorRef.current()
    }

    const timeout = new Promise<never>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error('three-load-timeout')), LOAD_TIMEOUT_MS)
    })

    Promise.race([
      import(/* @vite-ignore */ THREE_CDN_URL),
      timeout,
    ])
      .then((THREE: any) => {
        if (cancelled) return
        const container = containerRef.current
        if (!container) return
        threeRef.current = THREE

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.shadowMap.enabled = true
        renderer.shadowMap.type = THREE.PCFSoftShadowMap
        rendererRef.current = renderer
        container.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        sceneRef.current = scene

        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)
        cameraRef.current = camera

        const hemi = new THREE.HemisphereLight(0xfff6e8, 0x8a7a5f, 0.95)
        scene.add(hemi)
        const sun = new THREE.DirectionalLight(0xffffff, 1.7)
        sun.position.set(6, 11, 5)
        sun.castShadow = true
        sun.shadow.mapSize.set(2048, 2048)
        sun.shadow.bias = -0.0004
        scene.add(sun)
        sceneRef.current.userData.sun = sun

        const floorGroup = new THREE.Group()
        scene.add(floorGroup)
        floorGroupRef.current = floorGroup

        const applySize = () => {
          const width = container.clientWidth
          const height = container.clientHeight
          if (width === 0 || height === 0) return
          renderer.setSize(width, height)
          camera.aspect = width / height
          camera.updateProjectionMatrix()
          const aspect = width / height
          fitRef.current =
            aspect >= 1.25 ? 1 : aspect >= 0.95 ? 1.22 : aspect >= 0.7 ? 1.5 : 1.85
        }
        applySize()
        resizeObserver = new ResizeObserver(applySize)
        resizeObserver.observe(container)

        intersectionObserver = new IntersectionObserver(
          (entries) => {
            visibleRef.current = entries[0]?.isIntersecting ?? true
          },
          { threshold: 0.05 },
        )
        intersectionObserver.observe(container)

        // Click = pointer up within a few px of pointer down.
        let downX = 0
        let downY = 0
        const dom = renderer.domElement as HTMLCanvasElement
        dom.style.cursor = 'pointer'
        dom.addEventListener('pointerdown', (event: PointerEvent) => {
          downX = event.clientX
          downY = event.clientY
        })
        dom.addEventListener('pointerup', (event: PointerEvent) => {
          if (
            Math.abs(event.clientX - downX) > 6 ||
            Math.abs(event.clientY - downY) > 6
          ) {
            return
          }
          const rect = dom.getBoundingClientRect()
          const pointer = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
          )
          const raycaster = new THREE.Raycaster()
          raycaster.setFromCamera(pointer, camera)
          const hits = raycaster.intersectObjects(floorGroup.children, true)
          for (const hit of hits) {
            let node = hit.object
            while (node && !node.userData?.tableId) node = node.parent
            if (node?.userData?.tableId) {
              selectRef.current(node.userData.tableId as string)
              break
            }
          }
        })

        const clock = new THREE.Clock()
        const chipVector = new THREE.Vector3()
        const loop = () => {
          raf = window.requestAnimationFrame(loop)
          if (document.hidden || !visibleRef.current) return
          const t = clock.getElapsedTime()
          const camera = cameraRef.current
          const base = baseCamRef.current
          const fit = fitRef.current
          camera.position.set(
            base.x * fit + Math.sin(t * 0.25) * 0.9,
            (base.y + Math.cos(t * 0.19) * 0.3) * fit,
            base.z * fit,
          )
          camera.lookAt(0, 0.1, 0)

          for (const built of builtRef.current) {
            const phase = built.phase
            if (built.bell) {
              built.bell.position.y =
                2.42 + Math.sin(t * 3.2 + phase) * 0.16
              built.bell.rotation.z = Math.sin(t * 7 + phase) * 0.22
            }
            if (built.ring) {
              const pulse = 1 + Math.sin(t * 3.2 + phase) * 0.1
              built.ring.scale.set(pulse, pulse, 1)
              built.ring.material.opacity =
                0.32 + Math.sin(t * 3.2 + phase) * 0.2
            }
            if (built.sparkles) {
              built.sparkles.rotation.y = t * 1.4 + phase
              built.sparkles.position.y =
                1.12 + Math.sin(t * 2.2 + phase) * 0.06
            }
            for (const g of built.guests) {
              const p = g.phase
              g.root.position.y = Math.sin(t * 1.6 + p) * 0.018
              if (built.mode === 'eating') {
                // Served: lean in, eating arm rises to the mouth
                // with the elbow out, head nods with each bite.
                // The shaped cycle dwells at the top so the raised
                // arm stays readable instead of flashing past.
                const raw = 0.5 + 0.5 * Math.sin(t * 1.9 + p)
                const bite = raw * raw * (3 - 2 * raw)
                g.upper.rotation.x = 0.1 + bite * 0.15
                g.upper.rotation.y = Math.sin(t * 0.4 + p) * 0.06
                g.eatArm.rotation.x = -0.55 - bite * 1.35
                g.eatArm.rotation.z = g.eatSide * (0.12 + bite * 0.34)
                g.restArm.rotation.x =
                  -0.55 + Math.sin(t * 1.1 + p) * 0.05
                g.head.rotation.x = 0.08 + bite * 0.26
                g.head.rotation.y = Math.sin(t * 0.5 + p) * 0.1
              } else if (built.mode === 'ready') {
                // Ready: both guests sit up and look toward the
                // kitchen, expecting the food to arrive.
                g.upper.rotation.y = -0.68 + Math.sin(t * 0.9 + p) * 0.07
                g.upper.rotation.x = -0.02
                g.head.rotation.y = -0.5 + Math.sin(t * 0.9 + p) * 0.08
                g.head.rotation.x = -0.04
                g.armR.rotation.x = -0.5 + Math.sin(t * 1.3 + p) * 0.04
                g.armL.rotation.x = -0.5 + Math.cos(t * 1.2 + p) * 0.04
              } else if (built.mode === 'done') {
                // Paid: leaning back, relaxed, eating stopped.
                g.upper.rotation.x = -0.11 + Math.sin(t * 0.7 + p) * 0.02
                g.upper.rotation.y = Math.sin(t * 0.25 + p) * 0.1
                g.head.rotation.x = -0.05
                g.head.rotation.y = Math.sin(t * 0.3 + p) * 0.2
                g.armR.rotation.x = -0.3
                g.armL.rotation.x = -0.3
              } else {
                // Waiting: turn and look around the room, arms
                // resting with a slight impatient sway.
                g.upper.rotation.y = Math.sin(t * 0.3 + p * 1.7) * 0.3
                g.upper.rotation.x = 0.03 + Math.sin(t * 0.5 + p) * 0.04
                g.head.rotation.y = Math.sin(t * 0.35 + p * 1.7) * 0.5
                g.head.rotation.x = 0.04 + Math.sin(t * 0.8 + p) * 0.05
                g.armR.rotation.x = -0.55 + Math.sin(t * 1.2 + p) * 0.06
                g.armL.rotation.x = -0.55 + Math.cos(t * 1.05 + p) * 0.06
              }
            }
          }

          renderer.render(scene, camera)

          // Project the chip anchors onto the screen and move the
          // parent's HTML chips to match.
          const width = container.clientWidth
          const height = container.clientHeight
          const chips = chipEls.current
          if (chips) {
            for (const built of builtRef.current) {
              const id = built.group.userData.tableId as string
              const main = chips.get(id)
              if (main) {
                built.mainAnchor.getWorldPosition(chipVector)
                chipVector.project(camera)
                const x = (chipVector.x * 0.5 + 0.5) * width
                const y = (-chipVector.y * 0.5 + 0.5) * height
                main.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
                main.style.opacity = chipVector.z < 1 ? '1' : '0'
              }
              const bellChip = chips.get(`${id}:bell`)
              if (bellChip) {
                built.bellAnchor.getWorldPosition(chipVector)
                chipVector.project(camera)
                const x = (chipVector.x * 0.5 + 0.5) * width
                const y = (-chipVector.y * 0.5 + 0.5) * height
                bellChip.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
                bellChip.style.opacity = chipVector.z < 1 ? '1' : '0'
              }
            }
          }
        }
        loop()
        setSceneReady((value) => value + 1)
        readyRef.current()
      })
      .catch(fail)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf)
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      if (renderer) {
        renderer.dispose()
        renderer.domElement?.remove()
      }
      threeRef.current = null
      sceneRef.current = null
      rendererRef.current = null
      builtRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- (Re)build the table groups whenever the data changes ----
  useEffect(() => {
    const THREE = threeRef.current
    const floorGroup = floorGroupRef.current
    const scene = sceneRef.current
    if (!THREE || !floorGroup || !scene) return

    // Clear the previous build.
    for (const built of builtRef.current) {
      floorGroup.remove(built.group)
    }
    builtRef.current = []
    while (floorGroup.children.length > 0) {
      floorGroup.remove(floorGroup.children[0])
    }

    const visuals = visualsRef.current
    const n = visuals.length
    if (n === 0) return
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const spacing = 4.4
    const floorW = cols * spacing + 1.8
    const floorD = rows * spacing + 1.8

    const mat = (color: string, extra: Record<string, unknown> = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra })
    const woodTop = mat('#c98d4e', { roughness: 0.6 })
    const woodDark = mat('#8a5a28', { roughness: 0.7 })
    const chairWood = mat('#a97c50', { roughness: 0.75 })
    const cushion = mat('#e8dcc8')
    const floorMat = mat('#e9dec6', { roughness: 0.95 })
    const floorBaseMat = mat('#b49b72', { roughness: 0.95 })
    const whiteMat = mat('#ffffff', { roughness: 0.4 })
    const goldMat = mat('#f5b921', {
      roughness: 0.3,
      metalness: 0.55,
    })

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(floorW + 0.6, 0.28, floorD + 0.6),
      floorBaseMat,
    )
    base.position.y = -0.32
    base.receiveShadow = true
    floorGroup.add(base)
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(floorW, 0.3, floorD),
      floorMat,
    )
    floor.position.y = -0.15
    floor.receiveShadow = true
    floorGroup.add(floor)

    const sun = scene.userData.sun
    if (sun) {
      const extent = Math.max(floorW, floorD) * 0.75 + 2
      sun.shadow.camera.left = -extent
      sun.shadow.camera.right = extent
      sun.shadow.camera.top = extent
      sun.shadow.camera.bottom = -extent
      sun.shadow.camera.updateProjectionMatrix()
    }
    const dist = Math.max(floorW, floorD) * 0.86 + 3.2
    baseCamRef.current = { x: 0, y: dist * 0.66, z: dist * 1.02 }
    if (cameraRef.current) {
      cameraRef.current.position.set(0, dist * 0.66, dist * 1.02)
      cameraRef.current.lookAt(0, 0.1, 0)
    }

    const makeChair = () => {
      const chair = new THREE.Group()
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.07, 0.58), chairWood)
      seat.position.y = 0.47
      chair.add(seat)
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.5), cushion)
      pad.position.y = 0.52
      chair.add(pad)
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.62, 0.07), chairWood)
      back.position.set(0, 0.82, -0.26)
      chair.add(back)
      for (const [lx, lz] of [
        [-0.24, -0.24],
        [0.24, -0.24],
        [-0.24, 0.24],
        [0.24, 0.24],
      ] as const) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.47, 0.06),
          woodDark,
        )
        leg.position.set(lx, 0.235, lz)
        chair.add(leg)
      }
      return chair
    }

    const makeGuest = (index: number) => {
      const guest = new THREE.Group()
      const shirt = mat(SHIRT_COLORS[index % SHIRT_COLORS.length], {
        roughness: 0.9,
      })
      const skin = mat(SKIN_COLORS[index % SKIN_COLORS.length], {
        roughness: 0.65,
      })
      const hair = mat(HAIR_COLORS[index % HAIR_COLORS.length], {
        roughness: 0.95,
      })
      // Upper body (torso, head, arms) rides on a hip pivot so
      // the guest can turn, lean in to eat, or lean back.
      const upper = new THREE.Group()
      upper.position.y = 0.55
      guest.add(upper)
      const torso = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.17, 0.3, 6, 14),
        shirt,
      )
      torso.position.y = 0.31
      torso.rotation.x = 0.1
      upper.add(torso)
      // Head on its own pivot at the neck so it can look around
      // and nod while eating.
      const headGroup = new THREE.Group()
      headGroup.position.y = 0.58
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 16), skin)
      head.position.y = 0.15
      headGroup.add(head)
      const hairCap = new THREE.Mesh(
        new THREE.SphereGeometry(
          0.15,
          20,
          12,
          0,
          Math.PI * 2,
          0,
          Math.PI * 0.55,
        ),
        hair,
      )
      hairCap.position.y = 0.17
      headGroup.add(hairCap)
      upper.add(headGroup)
      // Arms pivot at the shoulders; at rest they reach forward
      // onto the table, and the eating arm rises to the mouth.
      const makeArm = (side: 1 | -1) => {
        const arm = new THREE.Group()
        arm.position.set(0.24 * side, 0.49, 0.03)
        const limb = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.06, 0.26, 4, 10),
          shirt,
        )
        limb.position.y = -0.17
        arm.add(limb)
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin)
        hand.position.y = -0.37
        arm.add(hand)
        arm.rotation.x = -0.55
        arm.rotation.z = side * 0.12
        upper.add(arm)
        return arm
      }
      const armR = makeArm(1)
      const armL = makeArm(-1)
      // A bright utensil in the eating hand makes the eating
      // motion easy to spot from across the room.
      const eatArmRef = index % 2 === 0 ? armR : armL
      const utensil = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.026, 0.24, 8),
        whiteMat,
      )
      utensil.position.set(0, -0.44, 0.03)
      utensil.rotation.x = 0.7
      eatArmRef.add(utensil)
      // Alternate the eating hand between guests for variety.
      const parts: GuestAnim = {
        root: guest,
        upper,
        head: headGroup,
        armR,
        armL,
        eatArm: index % 2 === 0 ? armR : armL,
        restArm: index % 2 === 0 ? armL : armR,
        eatSide: index % 2 === 0 ? 1 : -1,
        phase: index * 1.93,
      }
      return parts
    }

    visuals.forEach((visual, index) => {
      const group = new THREE.Group()
      const col = index % cols
      const row = Math.floor(index / cols)
      group.position.set(
        (col - (cols - 1) / 2) * spacing,
        0,
        (row - (rows - 1) / 2) * spacing,
      )
      group.userData.tableId = visual.table.id
      const phase = index * 1.37

      // Table: top, pedestal, base.
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.05, 0.09, 28),
        woodTop,
      )
      top.position.y = 0.78
      group.add(top)
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.74, 16),
        woodDark,
      )
      pedestal.position.y = 0.39
      group.add(pedestal)
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.55, 0.07, 24),
        woodDark,
      )
      foot.position.y = 0.035
      group.add(foot)

      // Four chairs around the table, each rotated to face it
      // (rotation set by hand — lookAt is unreliable before the
      // group joins the scene).
      for (let i = 0; i < 4; i += 1) {
        const angle = (i * Math.PI) / 2 + Math.PI / 4
        const chair = makeChair()
        chair.position.set(Math.sin(angle) * 1.62, 0, Math.cos(angle) * 1.62)
        chair.rotation.y = angle + Math.PI
        group.add(chair)
      }

      const built: BuiltTable = {
        group,
        bell: null,
        ring: null,
        sparkles: null,
        mode: visual.paid && visual.served
          ? 'done'
          : visual.served
            ? 'eating'
            : visual.status === 'READY'
              ? 'ready'
              : 'waiting',
        guests: [],
        mainAnchor: new THREE.Object3D(),
        bellAnchor: new THREE.Object3D(),
        phase,
      }
      // Neighbouring tables' chips stagger between two heights
      // so a long status chip never collides with the next one.
      built.mainAnchor.position.set(0, index % 2 === 0 ? 1.98 : 1.52, 0)
      group.add(built.mainAnchor)
      built.bellAnchor.position.set(0, 2.98, 0)
      group.add(built.bellAnchor)


      if (visual.state === 'occupied') {
        // Two guests on the two far chairs, facing the camera —
        // from the near chairs their backs and the chair backs
        // would hide the arm animation completely.
        for (const [gi, angle] of [
          [index * 2, (Math.PI * 3) / 4],
          [index * 2 + 1, (-Math.PI * 3) / 4],
        ] as const) {
          const parts = makeGuest(gi)
          parts.root.position.set(
            Math.sin(angle) * 1.62,
            0,
            Math.cos(angle) * 1.62,
          )
          parts.root.rotation.y = angle + Math.PI
          group.add(parts.root)
          built.guests.push(parts)
        }
        if (visual.served) {
          // Food arrives only once the order is SERVED.
          for (const [px, pz, foodColor] of [
            [-0.38, 0.28, '#e2703a'],
            [0.4, -0.24, '#b5542d'],
          ] as const) {
            const plate = new THREE.Mesh(
              new THREE.CylinderGeometry(0.17, 0.17, 0.025, 20),
              whiteMat,
            )
            plate.position.set(px, 0.84, pz)
            group.add(plate)
            const food = new THREE.Mesh(
              new THREE.SphereGeometry(0.075, 12, 10),
              mat(foodColor, { roughness: 0.7 }),
            )
            food.scale.y = 0.55
            food.position.set(px, 0.87, pz)
            group.add(food)
          }
          const drink = new THREE.Mesh(
            new THREE.CylinderGeometry(0.065, 0.055, 0.18, 12),
            mat('#f59e0b', { roughness: 0.35 }),
          )
          drink.position.set(0.12, 0.91, 0.42)
          group.add(drink)
        } else {
          // Still waiting: menu cards stand on the empty table.
          for (const [mx, mz, tilt] of [
            [-0.3, 0.2, 0.3],
            [0.34, -0.18, -0.4],
          ] as const) {
            const menu = new THREE.Mesh(
              new THREE.BoxGeometry(0.26, 0.34, 0.02),
              whiteMat,
            )
            menu.position.set(mx, 0.98, mz)
            menu.rotation.x = -0.22
            menu.rotation.y = tilt
            group.add(menu)
          }
        }
      }

      if (visual.state === 'cleaning') {
        const bottle = new THREE.Group()
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.08, 0.24, 12),
          mat('#38bdf8', { roughness: 0.4 }),
        )
        body.position.y = 0.12
        bottle.add(body)
        const neck = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.05, 0.05),
          mat('#0369a1', { roughness: 0.5 }),
        )
        neck.position.y = 0.27
        bottle.add(neck)
        bottle.position.set(-0.3, 0.83, 0.15)
        group.add(bottle)
        const cloth = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.03, 0.26),
          mat('#bae6fd', { roughness: 0.9 }),
        )
        cloth.position.set(0.32, 0.84, -0.1)
        cloth.rotation.y = 0.5
        group.add(cloth)
        // Orbiting sparkles.
        const sparkles = new THREE.Group()
        const starGeo = new THREE.OctahedronGeometry(0.055)
        const starMat = mat('#f59e0b', { roughness: 0.35 })
        for (let i = 0; i < 7; i += 1) {
          const star = new THREE.Mesh(starGeo, starMat)
          const a = (i / 7) * Math.PI * 2
          star.position.set(Math.cos(a) * 0.95, (i % 3) * 0.14, Math.sin(a) * 0.95)
          sparkles.add(star)
        }
        sparkles.position.y = 1.12
        group.add(sparkles)
        built.sparkles = sparkles
      }

      if (visual.state === 'reserved') {
        const pole = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.34, 0.05),
          woodDark,
        )
        pole.position.set(0.22, 1.0, 0.08)
        group.add(pole)
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(0.62, 0.32, 0.04),
          mat('#f59e0b', { roughness: 0.5 }),
        )
        sign.position.set(0.22, 1.24, 0.08)
        sign.rotation.x = -0.14
        group.add(sign)
      }

      if (visual.calling) {
        const bell = new THREE.Group()
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(0.27, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
          goldMat,
        )
        bell.add(dome)
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), goldMat)
        knob.position.y = 0.27
        bell.add(knob)
        const clapper = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 12, 10),
          woodDark,
        )
        clapper.position.y = -0.05
        bell.add(clapper)
        bell.position.y = 2.42
        group.add(bell)
        built.bell = bell

        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.28, 1.52, 40),
          new THREE.MeshBasicMaterial({
            color: '#f59e0b',
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
          }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.y = 0.02
        group.add(ring)
        built.ring = ring
      }

      group.traverse((node: any) => {
        if (node.isMesh) {
          node.castShadow = true
          node.receiveShadow = false
        }
      })
      floorGroup.add(group)
      builtRef.current.push(built)
    })
  }, [signature, sceneReady])

  return (
    <div
      ref={containerRef}
      className="h-[380px] w-full overflow-hidden rounded-xl md:h-[480px]"
      role="img"
      aria-label="3D live floor"
    />
  )
}
