const assert = require("node:assert/strict");
const test = require("node:test");
const agentBrain = require("../js/agent-brain.js");

function createBrainHarness({ mobile = false, visibilityState = "visible", rendererFailure = false } = {}) {
  const calls = {
    renders: 0,
    setPixelRatio: [],
    setSize: [],
    rendererOptions: null,
    rendererDisposed: 0,
    contextLost: false,
    geometryDisposed: 0,
    materialDisposed: 0,
    computedNormals: 0,
    sphereGeometryArgs: [],
    surfaceGeometries: [],
    meshes: [],
    brainGroups: [],
    materialInstances: [],
    lineSegmentGeometries: [],
    points: [],
    cancelledFrames: [],
    disconnectedObservers: 0,
    windowListeners: new Map(),
    documentListeners: new Map(),
    frameCallbacks: new Map()
  };
  let nextFrameId = 0;

  function createAttribute(points) {
    const array = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      array[index * 3] = point.x;
      array[index * 3 + 1] = point.y;
      array[index * 3 + 2] = point.z;
    });
    return {
      array,
      count: points.length,
      needsUpdate: false,
      getX(index) {
        return array[index * 3];
      },
      getY(index) {
        return array[index * 3 + 1];
      },
      getZ(index) {
        return array[index * 3 + 2];
      },
      setXYZ(index, x, y, z) {
        array[index * 3] = x;
        array[index * 3 + 1] = y;
        array[index * 3 + 2] = z;
      }
    };
  }

  class FakeVector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }

  class FakeObject3D {
    constructor() {
      this.children = [];
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        }
      };
      this.rotation = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        }
      };
      this.scale = {
        x: 1,
        y: 1,
        z: 1,
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        }
      };
    }
    add(...children) {
      this.children.push(...children);
    }
  }

  class FakeGeometry {
    constructor() {
      this.points = [];
      this.attributes = {};
      this.drawRange = { start: 0, count: Infinity };
    }
    setFromPoints(points) {
      this.points = points;
      this.attributes.position = createAttribute(points);
      return this;
    }
    setAttribute(name, attribute) {
      this.attributes[name] = attribute;
      return this;
    }
    getAttribute(name) {
      return this.attributes[name];
    }
    computeVertexNormals() {
      calls.computedNormals += 1;
    }
    setDrawRange(start, count) {
      this.drawRange = { start, count };
    }
    dispose() {
      calls.geometryDisposed += 1;
    }
  }

  class FakeSphereGeometry extends FakeGeometry {
    constructor(radius, widthSegments, heightSegments) {
      super();
      calls.sphereGeometryArgs.push([radius, widthSegments, heightSegments]);
      const points = [];
      for (let row = 0; row <= heightSegments; row += 1) {
        const phi = (row / heightSegments) * Math.PI;
        for (let column = 0; column <= widthSegments; column += 1) {
          const theta = (column / widthSegments) * Math.PI * 2;
          points.push(new FakeVector3(
            -radius * Math.cos(theta) * Math.sin(phi),
            radius * Math.cos(phi),
            radius * Math.sin(theta) * Math.sin(phi)
          ));
        }
      }
      this.attributes.position = createAttribute(points);
      calls.surfaceGeometries.push(this);
    }
  }

  class FakeBufferAttribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
      this.count = array.length / itemSize;
      this.needsUpdate = false;
    }
    setXYZ(index, x, y, z) {
      this.array[index * this.itemSize] = x;
      this.array[index * this.itemSize + 1] = y;
      this.array[index * this.itemSize + 2] = z;
    }
  }

  class FakeMaterial {
    constructor(options) {
      Object.assign(this, options);
      this.color = {
        value: options.color,
        setHex(value) {
          this.value = value;
        }
      };
      if (options.emissive !== undefined) {
        this.emissive = {
          value: options.emissive,
          setHex(value) {
            this.value = value;
          }
        };
      }
      calls.materialInstances.push(this);
    }
    dispose() {
      calls.materialDisposed += 1;
    }
  }

  class FakeColor {
    constructor(value) {
      this.value = value;
    }
    setHex(value) {
      this.value = value;
    }
  }

  class FakeRenderer {
    constructor(options) {
      if (rendererFailure) {
        throw new Error("WebGL is unavailable.");
      }
      calls.rendererOptions = options;
      this.domElement = {
        parentNode: null,
        setAttribute(name, value) {
          this[name] = value;
        }
      };
    }
    getContext() {
      return { isContextLost: () => calls.contextLost };
    }
    setPixelRatio(value) {
      calls.setPixelRatio.push(value);
    }
    setSize(width, height, updateStyle) {
      calls.setSize.push({ width, height, updateStyle });
    }
    render() {
      calls.renders += 1;
    }
    dispose() {
      calls.rendererDisposed += 1;
    }
  }

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      this.target = target;
    }
    disconnect() {
      calls.disconnectedObservers += 1;
    }
  }

  const THREE = {
    Scene: FakeObject3D,
    PerspectiveCamera: class extends FakeObject3D {
      updateProjectionMatrix() {}
    },
    Group: class extends FakeObject3D {
      constructor() {
        super();
        calls.brainGroups.push(this);
      }
    },
    SphereGeometry: FakeSphereGeometry,
    BufferGeometry: FakeGeometry,
    BufferAttribute: FakeBufferAttribute,
    MeshPhongMaterial: FakeMaterial,
    MeshBasicMaterial: FakeMaterial,
    ShaderMaterial: FakeMaterial,
    LineBasicMaterial: FakeMaterial,
    PointsMaterial: FakeMaterial,
    Color: FakeColor,
    AmbientLight: FakeObject3D,
    PointLight: class extends FakeObject3D {
      constructor(color) {
        super();
        this.color = {
          value: color,
          setHex(value) {
            this.value = value;
          }
        };
      }
    },
    Mesh: class extends FakeObject3D {
      constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
        calls.meshes.push(this);
      }
    },
    Line: class extends FakeObject3D {
      constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
      }
    },
    LineSegments: class extends FakeObject3D {
      constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
        calls.lineSegmentGeometries.push(geometry);
      }
    },
    Points: class extends FakeObject3D {
      constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
        calls.points.push(this);
      }
    },
    Vector3: FakeVector3,
    WebGLRenderer: FakeRenderer,
    AdditiveBlending: 2,
    BackSide: 1,
    DoubleSide: 2
  };

  const container = {
    clientWidth: mobile ? 360 : 900,
    clientHeight: mobile ? 200 : 240,
    dataset: {},
    attributes: {},
    children: [],
    replaceChildren() {
      for (const child of this.children) {
        child.parentNode = null;
      }
      this.children = [];
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
  const stateElement = { dataset: {} };
  const documentRef = {
    visibilityState,
    addEventListener(name, callback) {
      calls.documentListeners.set(name, callback);
    },
    removeEventListener(name) {
      calls.documentListeners.delete(name);
    }
  };
  const windowRef = {
    devicePixelRatio: 3,
    ResizeObserver: FakeResizeObserver,
    matchMedia(query) {
      return { matches: query === "(max-width: 600px)" && mobile };
    },
    requestAnimationFrame(callback) {
      const id = ++nextFrameId;
      calls.frameCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      calls.cancelledFrames.push(id);
      calls.frameCallbacks.delete(id);
    },
    addEventListener(name, callback) {
      calls.windowListeners.set(name, callback);
    },
    removeEventListener(name) {
      calls.windowListeners.delete(name);
    }
  };

  return {
    calls,
    container,
    documentRef,
    stateElement,
    THREE,
    windowRef
  };
}

test("Agent Brain maps all database states and unknown values safely", () => {
  assert.equal(agentBrain.mapAgentStatus("active").status, "ACTIVE");
  assert.equal(agentBrain.mapAgentStatus("ANALYZING").activityPoints, 48);
  assert.ok(agentBrain.mapAgentStatus("ANALYZING").pulseSpeed
    > agentBrain.mapAgentStatus("ACTIVE").pulseSpeed);
  assert.equal(agentBrain.mapAgentStatus("IDLE").mode, "breathing");
  assert.equal(agentBrain.mapAgentStatus("STOPPED").animated, false);
  assert.equal(agentBrain.mapAgentStatus("ERROR").mode, "warning");
  assert.ok(agentBrain.pulseIntensity(agentBrain.mapAgentStatus("ERROR"), 0.2, 0)
    > agentBrain.pulseIntensity(agentBrain.mapAgentStatus("ERROR"), 2.2, 0));
  assert.equal(agentBrain.mapAgentStatus(null).status, "UNKNOWN");
  assert.equal(agentBrain.mapAgentStatus("unrecognized").mode, "neutral");
});

test("Agent Brain caps renderer pixel ratio for desktop and mobile performance", () => {
  assert.equal(agentBrain.getPixelRatio(3, false), 1.5);
  assert.equal(agentBrain.getPixelRatio(3, true), 1.25);
  assert.equal(agentBrain.getPixelRatio(1, false), 1);
  assert.equal(agentBrain.getPixelRatio(0, false), 1);
  assert.equal(agentBrain.performanceLimits.maxFramesPerSecond, 30);
  assert.equal(agentBrain.performanceLimits.maxActivityPoints, 48);
  assert.equal(agentBrain.performanceLimits.maxNeuralNodes, 720);
  assert.equal(agentBrain.performanceLimits.maxConnections, 2160);
});

test("Agent Brain drives neural network glow by status without rotating the graph", () => {
  const harness = createBrainHarness();
  const brain = agentBrain.createAgentBrain({
    THREE: harness.THREE,
    container: harness.container,
    windowRef: harness.windowRef,
    documentRef: harness.documentRef,
    initialStatus: "IDLE"
  });
  const lineMaterial = harness.calls.materialInstances.find((material) => material.vertexColors);
  const nodeMaterial = harness.calls.points.find(({ material }) => material.size === 0.032).material;
  const hotspotMaterial = harness.calls.points.find(({ material }) => material.size === 0.085).material;
  const brainGroup = harness.calls.brainGroups[0];

  brain.setStatus("ACTIVE");
  assert.equal(nodeMaterial.color.value, hotspotMaterial.color.value);
  const activeLineGlow = lineMaterial.opacity;
  const activeNeuronGlow = hotspotMaterial.opacity;
  brain.setStatus("ANALYZING");
  assert.ok(lineMaterial.opacity > activeLineGlow);
  assert.ok(nodeMaterial.opacity > activeLineGlow);
  assert.ok(hotspotMaterial.opacity > activeNeuronGlow);
  const connectionGeometry = harness.calls.lineSegmentGeometries[0];
  const connectionPositions = connectionGeometry.getAttribute("position");
  const connectionColors = connectionGeometry.getAttribute("color");
  const sampleHemisphereColor = (side) => {
    for (let index = 0; index < connectionPositions.count; index += 2) {
      const midpointX = (connectionPositions.getX(index)
        + connectionPositions.getX(index + 1)) / 2;
      if ((side < 0 && midpointX < -0.1) || (side > 0 && midpointX > 0.1)) {
        return [
          connectionColors.array[index * 3],
          connectionColors.array[index * 3 + 1],
          connectionColors.array[index * 3 + 2]
        ];
      }
    }
    return null;
  };
  const leftColor = sampleHemisphereColor(-1);
  const rightColor = sampleHemisphereColor(1);
  assert.ok(leftColor && rightColor);
  assert.ok(Math.abs(leftColor[0] / leftColor[2] - rightColor[0] / rightColor[2]) < 0.00001);
  assert.ok(Math.abs(leftColor[1] / leftColor[2] - rightColor[1] / rightColor[2]) < 0.00001);

  brain.setStatus("IDLE");
  assert.ok(lineMaterial.opacity < activeLineGlow);
  brain.setStatus("STOPPED");
  assert.equal(harness.calls.frameCallbacks.size, 0);
  assert.ok(lineMaterial.opacity < activeLineGlow);
  assert.equal(harness.calls.points.find(({ material }) => material.size === 0.075)
    .geometry.drawRange.count, 0);
  brain.setStatus("ERROR");
  assert.equal(lineMaterial.color.value, 0xffffff);
  assert.equal(nodeMaterial.color.value, 0xff4655);
  assert.equal(harness.calls.points.find(({ material }) => material.size === 0.075)
    .geometry.drawRange.count, 20);

  const runFrame = (timestamp) => {
    const [frameId, callback] = harness.calls.frameCallbacks.entries().next().value;
    harness.calls.frameCallbacks.delete(frameId);
    callback(timestamp);
  };
  runFrame(200);
  const warningGlow = lineMaterial.opacity;
  runFrame(1600);
  assert.ok(lineMaterial.opacity < warningGlow);
  assert.equal(brainGroup.rotation.x, 0);
  assert.equal(brainGroup.rotation.y, 0);

  brain.dispose();
});

test("Agent Brain initializes a low-power renderer and pauses/resumes animation with page visibility", () => {
  const harness = createBrainHarness();
  const brain = agentBrain.createAgentBrain({
    THREE: harness.THREE,
    container: harness.container,
    stateElement: harness.stateElement,
    windowRef: harness.windowRef,
    documentRef: harness.documentRef,
    initialStatus: "ACTIVE"
  });

  assert.equal(brain.available, true);
  assert.equal(brain.isAvailable(), true);
  assert.equal(harness.calls.rendererOptions.antialias, true);
  assert.equal(harness.calls.rendererOptions.powerPreference, "low-power");
  assert.deepEqual(harness.calls.sphereGeometryArgs, []);
  assert.equal(harness.calls.surfaceGeometries.length, 0);
  assert.equal(harness.calls.computedNormals, 0);
  assert.equal(harness.calls.meshes.length, 0);
  const neuralNodes = harness.calls.points.find(({ material }) => material.size === 0.032);
  assert.equal(neuralNodes.geometry.getAttribute("position").count, 720);
  const networkPositions = neuralNodes.geometry.getAttribute("position");
  let minimumNetworkX = Infinity;
  let maximumNetworkX = -Infinity;
  let minimumNetworkY = Infinity;
  let maximumNetworkY = -Infinity;
  let networkMaxX = 0;
  let midlineNodeCount = 0;
  let leftHemisphereNodes = 0;
  let rightHemisphereNodes = 0;
  for (let index = 0; index < networkPositions.count; index += 1) {
    const x = networkPositions.getX(index);
    const y = networkPositions.getY(index);
    minimumNetworkX = Math.min(minimumNetworkX, x);
    maximumNetworkX = Math.max(maximumNetworkX, x);
    minimumNetworkY = Math.min(minimumNetworkY, y);
    maximumNetworkY = Math.max(maximumNetworkY, y);
    networkMaxX = Math.max(networkMaxX, Math.abs(x));
    if (Math.abs(x) < 0.04 && y > -0.34) {
      midlineNodeCount += 1;
    }
    if (x < -0.1) {
      leftHemisphereNodes += 1;
    } else if (x > 0.1) {
      rightHemisphereNodes += 1;
    }
  }
  assert.ok(minimumNetworkX < -0.5);
  assert.ok(maximumNetworkX > 0.5);
  assert.ok(minimumNetworkY < -0.54);
  assert.ok(minimumNetworkY > -0.56);
  assert.ok(maximumNetworkY > 0.4);
  assert.equal(midlineNodeCount, 0);
  assert.ok(Math.min(leftHemisphereNodes, rightHemisphereNodes) > 250);
  assert.ok(networkMaxX > 0.5);
  const connectionPosition = harness.calls.lineSegmentGeometries[0].getAttribute("position");
  assert.ok(connectionPosition.count > 1000);
  assert.equal(connectionPosition.count, 1470);
  let leftContourInnerEdge = -Infinity;
  let leftContourOuterEdge = Infinity;
  let leftContourTop = -Infinity;
  let leftContourBottom = Infinity;
  for (let index = 0; index < 80; index += 1) {
    const x = networkPositions.getX(index);
    const y = networkPositions.getY(index);
    leftContourInnerEdge = Math.max(leftContourInnerEdge, x);
    leftContourOuterEdge = Math.min(leftContourOuterEdge, x);
    leftContourTop = Math.max(leftContourTop, y);
    leftContourBottom = Math.min(leftContourBottom, y);
    const segmentStart = index * 2;
    const nextPoint = (index + 1) % 80;
    assert.equal(connectionPosition.getX(segmentStart), x);
    assert.equal(connectionPosition.getY(segmentStart), y);
    assert.equal(connectionPosition.getX(segmentStart + 1), networkPositions.getX(nextPoint));
    assert.equal(connectionPosition.getY(segmentStart + 1), networkPositions.getY(nextPoint));
  }
  assert.ok(leftContourOuterEdge < -0.5);
  assert.ok(leftContourInnerEdge < -0.04 && leftContourInnerEdge > -0.06);
  assert.ok(leftContourTop > 0.46);
  assert.ok(leftContourBottom < -0.4);
  const uniqueLineGeometries = [...new Set(harness.calls.lineSegmentGeometries)];
  assert.equal(uniqueLineGeometries.length, 1);
  assert.ok(harness.calls.lineSegmentGeometries.every((geometry) =>
    geometry === harness.calls.lineSegmentGeometries[0]
  ));
  assert.ok(harness.calls.lineSegmentGeometries[0].getAttribute("position").count
    <= agentBrain.performanceLimits.maxConnections * 2);
  let leftHemisphereConnections = 0;
  let rightHemisphereConnections = 0;
  for (let index = 0; index < connectionPosition.count; index += 2) {
    const startX = connectionPosition.getX(index);
    const endX = connectionPosition.getX(index + 1);
    const midpointX = (startX + endX) / 2;
    const midpointY = (
      connectionPosition.getY(index) + connectionPosition.getY(index + 1)
    ) / 2;
    assert.ok(!(startX < -0.025 && endX > 0.025 && midpointY > -0.34));
    assert.ok(!(startX > 0.025 && endX < -0.025 && midpointY > -0.34));
    if (midpointX < -0.12) {
      leftHemisphereConnections += 1;
    } else if (midpointX > 0.12) {
      rightHemisphereConnections += 1;
    }
  }
  const hemisphereBalance = Math.min(leftHemisphereConnections, rightHemisphereConnections)
    / Math.max(leftHemisphereConnections, rightHemisphereConnections);
  assert.ok(hemisphereBalance > 0.65);
  assert.deepEqual(harness.calls.setPixelRatio, [1.5]);
  assert.ok(harness.calls.setSize.some(({ width, height }) => width === 900 && height === 240));
  assert.equal(harness.container.children.length, 1);
  assert.equal(harness.stateElement.dataset.state, "active");
  assert.equal(harness.calls.frameCallbacks.size, 1);

  const visibilityListener = harness.calls.documentListeners.get("visibilitychange");
  harness.documentRef.visibilityState = "hidden";
  visibilityListener();
  assert.equal(harness.calls.frameCallbacks.size, 0);
  assert.equal(harness.calls.cancelledFrames.length, 1);

  harness.documentRef.visibilityState = "visible";
  visibilityListener();
  assert.equal(harness.calls.frameCallbacks.size, 1);
  brain.setStatus("STOPPED");
  assert.equal(harness.stateElement.dataset.state, "stopped");
  const stoppedColor = harness.calls.points.find(({ material }) => material.size === 0.032)
    .material.color.value;
  const stoppedChannels = [
    (stoppedColor >> 16) & 0xff,
    (stoppedColor >> 8) & 0xff,
    stoppedColor & 0xff
  ];
  assert.ok(Math.max(...stoppedChannels) - Math.min(...stoppedChannels) < 35);
  assert.equal(harness.calls.frameCallbacks.size, 0);
  assert.ok(harness.calls.renders >= 3);

  brain.dispose();
  assert.equal(brain.isAvailable(), false);
  assert.equal(harness.calls.rendererDisposed, 1);
  assert.ok(harness.calls.geometryDisposed > 0);
  assert.ok(harness.calls.materialDisposed > 0);
  assert.equal(harness.calls.disconnectedObservers, 1);
  assert.equal(harness.calls.documentListeners.size, 0);
  assert.equal(harness.calls.windowListeners.size, 0);
  assert.equal(harness.container.children.length, 0);
});

test("Agent Brain reports a lost WebGL context as unavailable", () => {
  const harness = createBrainHarness();
  const brain = agentBrain.createAgentBrain({
    THREE: harness.THREE,
    container: harness.container,
    windowRef: harness.windowRef,
    documentRef: harness.documentRef,
    initialStatus: "ACTIVE"
  });

  assert.equal(brain.isAvailable(), true);
  harness.calls.contextLost = true;
  assert.equal(brain.isAvailable(), false);
  brain.dispose();
});

test("Agent Brain applies the mobile pixel-ratio safeguard and frame-rate cap", () => {
  const harness = createBrainHarness({ mobile: true });
  const brain = agentBrain.createAgentBrain({
    THREE: harness.THREE,
    container: harness.container,
    windowRef: harness.windowRef,
    documentRef: harness.documentRef,
    initialStatus: "ANALYZING"
  });
  assert.equal(harness.calls.rendererOptions.antialias, false);
  assert.deepEqual(harness.calls.setPixelRatio, [1.25]);
  const initialRenderCount = harness.calls.renders;
  const brainGroup = harness.calls.brainGroups[0];
  const initialScale = { ...brainGroup.scale };

  const [frameId, firstFrame] = harness.calls.frameCallbacks.entries().next().value;
  harness.calls.frameCallbacks.delete(frameId);
  firstFrame(16);
  assert.equal(harness.calls.renders, initialRenderCount);
  const [nextFrameId, secondFrame] = harness.calls.frameCallbacks.entries().next().value;
  const energyGeometry = harness.calls.points.find(({ material }) => material.size === 0.075).geometry;
  const energyPositions = energyGeometry.getAttribute("position");
  const initialEnergyPositions = [...energyPositions.array];
  const hotspotGeometry = harness.calls.points.find(({ material }) => material.size === 0.085).geometry;
  const hotspotPositions = hotspotGeometry.getAttribute("position");
  const initialHotspotPositions = [...hotspotPositions.array];
  const linePositions = harness.calls.lineSegmentGeometries[0].getAttribute("position");
  const initialLinePositions = [...linePositions.array];
  const connectionColors = harness.calls.lineSegmentGeometries[0].getAttribute("color");
  const initialConnectionColors = [...connectionColors.array];
  harness.calls.frameCallbacks.delete(nextFrameId);
  secondFrame(34);
  assert.equal(harness.calls.renders, initialRenderCount + 1);
  assert.equal(energyPositions.needsUpdate, true);
  assert.notDeepEqual([...energyPositions.array], initialEnergyPositions);
  assert.equal(hotspotPositions.needsUpdate, true);
  assert.notDeepEqual([...hotspotPositions.array], initialHotspotPositions);
  assert.equal(linePositions.needsUpdate, true);
  assert.notDeepEqual([...linePositions.array], initialLinePositions);
  assert.equal(connectionColors.needsUpdate, true);
  assert.notDeepEqual([...connectionColors.array], initialConnectionColors);
  assert.equal(brainGroup.rotation.x, 0);
  assert.equal(brainGroup.rotation.y, 0);
  assert.deepEqual(brainGroup.scale, initialScale);

  brain.dispose();
  assert.equal(harness.calls.frameCallbacks.size, 0);
});

test("Agent Brain falls back safely when WebGL initialization is unavailable", () => {
  const harness = createBrainHarness({ rendererFailure: true });

  assert.doesNotThrow(() => {
    const brain = agentBrain.createAgentBrain({
      THREE: harness.THREE,
      container: harness.container,
      windowRef: harness.windowRef,
      documentRef: harness.documentRef,
      initialStatus: null
    });
    assert.equal(brain.available, false);
    brain.setStatus("UNKNOWN");
    brain.dispose();
  });
  assert.equal(harness.container.children.length, 0);
});
