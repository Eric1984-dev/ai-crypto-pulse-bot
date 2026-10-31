(function attachAgentBrain(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.CryptoPulseAgentBrain = api;
  }
})(globalThis, function createAgentBrainApi() {
  const statusMap = Object.freeze({
    ACTIVE: Object.freeze({
      status: "ACTIVE",
      color: 0x389cff,
      emissiveIntensity: 0.8,
      pulseSpeed: 1.7,
      pulseAmount: 0.035,
      activityPoints: 24,
      animated: true,
      mode: "continuous"
    }),
    ANALYZING: Object.freeze({
      status: "ANALYZING",
      color: 0x36b8ff,
      emissiveIntensity: 1.45,
      pulseSpeed: 3.2,
      pulseAmount: 0.07,
      activityPoints: 48,
      animated: true,
      mode: "continuous"
    }),
    IDLE: Object.freeze({
      status: "IDLE",
      color: 0x76aee2,
      emissiveIntensity: 0.38,
      pulseSpeed: 0.48,
      pulseAmount: 0.018,
      activityPoints: 6,
      animated: true,
      mode: "breathing"
    }),
    STOPPED: Object.freeze({
      status: "STOPPED",
      color: 0x87919b,
      emissiveIntensity: 0.08,
      pulseSpeed: 0,
      pulseAmount: 0,
      activityPoints: 0,
      animated: false,
      mode: "static"
    }),
    ERROR: Object.freeze({
      status: "ERROR",
      color: 0xff4655,
      emissiveIntensity: 1.15,
      pulseSpeed: 2.4,
      pulseAmount: 0.055,
      activityPoints: 18,
      animated: true,
      mode: "warning"
    }),
    UNKNOWN: Object.freeze({
      status: "UNKNOWN",
      color: 0x8c99a6,
      emissiveIntensity: 0.12,
      pulseSpeed: 0,
      pulseAmount: 0,
      activityPoints: 0,
      animated: false,
      mode: "neutral"
    })
  });

  const performanceLimits = Object.freeze({
    maxFramesPerSecond: 30,
    maxPixelRatio: 1.5,
    mobilePixelRatio: 1.25,
    maxActivityPoints: 48,
    maxNeuralNodes: 720,
    maxConnections: 2160
  });

  function mapAgentStatus(status) {
    const key = typeof status === "string" ? status.trim().toUpperCase() : "";
    return statusMap[key] || statusMap.UNKNOWN;
  }

  function getPixelRatio(devicePixelRatio, isMobile) {
    const requestedRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
    return Math.min(
      requestedRatio,
      isMobile ? performanceLimits.mobilePixelRatio : performanceLimits.maxPixelRatio
    );
  }

  function createAgentBrain({
    THREE,
    container,
    stateElement = container,
    windowRef = window,
    documentRef = document,
    initialStatus = null
  } = {}) {
    const unavailableBrain = {
      available: false,
      isAvailable() {
        return false;
      },
      setStatus() {},
      dispose() {}
    };

    if (!THREE || !container || typeof THREE.WebGLRenderer !== "function") {
      return unavailableBrain;
    }

    let renderer;
    let resizeObserver;
    let animationFrame = null;
    let disposed = false;
    let visible = documentRef.visibilityState !== "hidden";
    let lastRenderAt = 0;
    let resizeHandler = null;
    let visibilityHandler = null;
    let pageHideHandler = null;
    let pageShowHandler = null;
    let config = mapAgentStatus(initialStatus);
    const geometries = new Set();
    const materials = new Set();

    try {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
      camera.position.z = 2.75;
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: "low-power"
      });
      renderer.setPixelRatio(getPixelRatio(
        windowRef.devicePixelRatio,
        isMobileViewport(windowRef, container)
      ));
      renderer.setSize(1, 1, false);
      renderer.domElement.className = "agent-brain-canvas";
      if (typeof renderer.domElement.setAttribute === "function") {
        renderer.domElement.setAttribute("aria-hidden", "true");
      }
      container.replaceChildren();
      container.appendChild(renderer.domElement);

      const brain = new THREE.Group();
      scene.add(brain);
      const nodePositions = createNodePositions(THREE);
      const connectionPairs = createConnectionPairs(nodePositions);
      const connectionsGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      connectionsGeometry.setFromPoints(createConnectionLinePoints(nodePositions, connectionPairs));
      const connectionPositionAttribute = connectionsGeometry.getAttribute("position");
      const connectionColorAttribute = new THREE.BufferAttribute(
        new Float32Array(connectionPairs.length * 6),
        3
      );
      connectionsGeometry.setAttribute("color", connectionColorAttribute);
      const connectionMaterial = trackMaterial(materials, new THREE.LineBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.56,
        depthTest: false,
        depthWrite: false
      }));
      const connectionGlowMaterial = trackMaterial(materials, new THREE.LineBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.16,
        depthTest: false,
        depthWrite: false
      }));
      brain.add(new THREE.LineSegments(connectionsGeometry, connectionGlowMaterial));
      brain.add(new THREE.LineSegments(connectionsGeometry, connectionMaterial));

      const nodeGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      nodeGeometry.setFromPoints(nodePositions);
      const nodePositionAttribute = nodeGeometry.getAttribute("position");
      const animatedNodePositions = new Float32Array(nodePositions.length * 3);
      const nodeGlowMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: config.color,
        size: 0.066,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.28,
        depthTest: false,
        depthWrite: false
      }));
      brain.add(new THREE.Points(nodeGeometry, nodeGlowMaterial));
      const nodeMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: config.color,
        size: 0.021,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false
      }));
      brain.add(new THREE.Points(nodeGeometry, nodeMaterial));

      const activityGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      activityGeometry.setFromPoints(createEnergyParticlePositions(THREE, nodePositions, connectionPairs));
      activityGeometry.setDrawRange(0, config.activityPoints);
      const activityMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: config.color,
        size: 0.065,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.98,
        depthTest: false,
        depthWrite: false
      }));
      const activityGlowMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: config.color,
        size: 0.15,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.32,
        depthTest: false,
        depthWrite: false
      }));
      brain.add(new THREE.Points(activityGeometry, activityGlowMaterial));
      brain.add(new THREE.Points(activityGeometry, activityMaterial));

      function resize() {
        if (disposed) {
          return;
        }
        const width = Math.max(1, container.clientWidth || 320);
        const height = Math.max(1, container.clientHeight || 200);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        renderStatic();
      }

      function renderStatic() {
        if (!disposed) {
          renderer.render(scene, camera);
        }
      }

      function stopAnimation() {
        if (animationFrame !== null && typeof windowRef.cancelAnimationFrame === "function") {
          windowRef.cancelAnimationFrame(animationFrame);
        }
        animationFrame = null;
      }

      function canAnimate() {
        return !disposed && visible && config.animated
          && typeof windowRef.requestAnimationFrame === "function";
      }

      function isRendererAvailable() {
        if (disposed || !renderer) {
          return false;
        }
        if (typeof renderer.getContext !== "function") {
          return true;
        }
        const context = renderer.getContext();
        return Boolean(context)
          && (typeof context.isContextLost !== "function" || !context.isContextLost());
      }

      function animate(timestamp) {
        animationFrame = null;
        if (!canAnimate()) {
          return;
        }

        const minimumFrameInterval = 1000 / performanceLimits.maxFramesPerSecond;
        if (timestamp - lastRenderAt >= minimumFrameInterval) {
          const elapsed = timestamp * 0.001 * config.pulseSpeed;
          const breath = Math.sin(elapsed);
          brain.rotation.y = Math.sin(elapsed * 0.35) * 0.12
            + (config.mode === "continuous" ? elapsed * 0.045 : 0);
          brain.rotation.x = Math.sin(elapsed * 0.42) * 0.045;
          const scale = 1 + breath * config.pulseAmount;
          brain.scale.set(scale, scale, scale);
          updateNeuralNetwork(
            nodePositionAttribute,
            connectionPositionAttribute,
            connectionColorAttribute,
            nodePositions,
            connectionPairs,
            animatedNodePositions,
            config,
            elapsed
          );
          updateEnergyParticles(
            activityGeometry,
            connectionPairs,
            animatedNodePositions,
            config.activityPoints,
            elapsed
          );
          const intensity = pulseIntensity(config, elapsed, breath);
          connectionMaterial.opacity = 0.22 + Math.max(0, intensity) * 0.34;
          connectionGlowMaterial.opacity = 0.08 + Math.max(0, intensity) * 0.16;
          nodeMaterial.opacity = 0.62 + Math.max(0, intensity) * 0.34;
          nodeGlowMaterial.opacity = 0.12 + Math.max(0, intensity) * 0.18;
          renderer.render(scene, camera);
          lastRenderAt = timestamp;
        }
        animationFrame = windowRef.requestAnimationFrame(animate);
      }

      function startAnimation() {
        if (animationFrame === null && canAnimate()) {
          animationFrame = windowRef.requestAnimationFrame(animate);
        }
      }

      function applyStatus(status) {
        config = mapAgentStatus(status);
        if (stateElement) {
          stateElement.dataset.state = config.status.toLowerCase();
        }
        if (typeof container.setAttribute === "function") {
          container.setAttribute("aria-label", `3D Agent Brain; status ${config.status}`);
        }
        setMaterialColor(connectionMaterial, config.color);
        setMaterialColor(connectionGlowMaterial, config.color);
        setMaterialColor(nodeMaterial, config.color);
        setMaterialColor(nodeGlowMaterial, config.color);
        setMaterialColor(activityMaterial, config.color);
        setMaterialColor(activityGlowMaterial, config.color);
        connectionMaterial.color.setHex(0xffffff);
        connectionGlowMaterial.color.setHex(0xffffff);
        activityGeometry.setDrawRange(0, config.activityPoints);
        updateNeuralNetwork(
          nodePositionAttribute,
          connectionPositionAttribute,
          connectionColorAttribute,
          nodePositions,
          connectionPairs,
          animatedNodePositions,
          config,
          0
        );
        updateEnergyParticles(
          activityGeometry,
          connectionPairs,
          animatedNodePositions,
          config.activityPoints,
          0
        );
        const intensity = pulseIntensity(config, 0, 0);
        connectionMaterial.opacity = 0.22 + Math.max(0, intensity) * 0.34;
        connectionGlowMaterial.opacity = 0.08 + Math.max(0, intensity) * 0.16;
        nodeMaterial.opacity = 0.62 + Math.max(0, intensity) * 0.34;
        nodeGlowMaterial.opacity = 0.12 + Math.max(0, intensity) * 0.18;
        brain.scale.set(1, 1, 1);
        brain.rotation.set(0, 0, 0);
        lastRenderAt = 0;
        stopAnimation();
        renderStatic();
        startAnimation();
        return config;
      }

      function onVisibilityChange() {
        visible = documentRef.visibilityState !== "hidden";
        if (visible) {
          lastRenderAt = 0;
          renderStatic();
          startAnimation();
        } else {
          stopAnimation();
        }
      }

      function onPageHide(event) {
        if (event && event.persisted) {
          visible = false;
          stopAnimation();
          return;
        }
        disposeResources();
      }

      function onPageShow(event) {
        if (event && event.persisted) {
          onVisibilityChange();
        }
      }

      function disposeResources() {
        if (disposed) {
          return;
        }
        disposed = true;
        stopAnimation();
        if (resizeObserver) {
          resizeObserver.disconnect();
        } else if (typeof windowRef.removeEventListener === "function") {
          windowRef.removeEventListener("resize", resize);
        }
        if (typeof documentRef.removeEventListener === "function") {
          documentRef.removeEventListener("visibilitychange", onVisibilityChange);
        }
        if (typeof windowRef.removeEventListener === "function") {
          windowRef.removeEventListener("pagehide", onPageHide);
          windowRef.removeEventListener("pageshow", onPageShow);
        }
        for (const geometry of geometries) {
          geometry.dispose();
        }
        for (const material of materials) {
          material.dispose();
        }
        if (renderer) {
          renderer.dispose();
          if (renderer.domElement.parentNode === container) {
            container.removeChild(renderer.domElement);
          }
        }
      }

      resizeHandler = resize;
      visibilityHandler = onVisibilityChange;
      pageHideHandler = onPageHide;
      pageShowHandler = onPageShow;
      if (typeof windowRef.ResizeObserver === "function") {
        resizeObserver = new windowRef.ResizeObserver(resize);
        resizeObserver.observe(container);
      } else if (typeof windowRef.addEventListener === "function") {
        windowRef.addEventListener("resize", resize);
      }
      if (typeof documentRef.addEventListener === "function") {
        documentRef.addEventListener("visibilitychange", onVisibilityChange);
      }
      if (typeof windowRef.addEventListener === "function") {
        windowRef.addEventListener("pagehide", onPageHide);
        windowRef.addEventListener("pageshow", onPageShow);
      }

      resize();
      const instance = {
        available: true,
        isAvailable: isRendererAvailable,
        setStatus: applyStatus,
        dispose: disposeResources
      };
      applyStatus(initialStatus);
      return instance;
    } catch (error) {
      if (animationFrame !== null && typeof windowRef.cancelAnimationFrame === "function") {
        windowRef.cancelAnimationFrame(animationFrame);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else if (resizeHandler && typeof windowRef.removeEventListener === "function") {
        windowRef.removeEventListener("resize", resizeHandler);
      }
      if (visibilityHandler && typeof documentRef.removeEventListener === "function") {
        documentRef.removeEventListener("visibilitychange", visibilityHandler);
      }
      if (pageHideHandler && typeof windowRef.removeEventListener === "function") {
        windowRef.removeEventListener("pagehide", pageHideHandler);
      }
      if (pageShowHandler && typeof windowRef.removeEventListener === "function") {
        windowRef.removeEventListener("pageshow", pageShowHandler);
      }
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of materials) {
        material.dispose();
      }
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      }
      return { ...unavailableBrain, error };
    }
  }

  function createNodePositions(THREE) {
    const positions = [];
    const brainStemCount = Math.round(performanceLimits.maxNeuralNodes * 0.055);
    const pointsPerHemisphere = (performanceLimits.maxNeuralNodes - brainStemCount) / 2;
    const goldenAngle = 2.399963229728653;

    for (const side of [-1, 1]) {
      for (let index = 0; index < pointsPerHemisphere; index += 1) {
        const lateral = (index + 0.5) / pointsPerHemisphere;
        const angle = index * goldenAngle + (side > 0 ? 0.23 : 0);
        const ringRadius = Math.sqrt(1 - lateral * lateral);
        const vertical = ringRadius * Math.cos(angle);
        const depth = ringRadius * Math.sin(angle);
        const folds = Math.sin(angle * 5.2 + lateral * 13 + side * 0.4) * 0.075
          + Math.cos(angle * 8 - lateral * 9) * 0.035
          + Math.sin(angle * 3.1 + side * 0.9) * 0.035;
        const contour = 1 + folds;

        positions.push(new THREE.Vector3(
          side * (0.055 + lateral * 0.88 * contour),
          vertical * 0.49 * contour,
          depth * 0.32 * contour * (1 + Math.max(0, depth) * 0.035)
        ));
      }
    }

    for (let index = 0; index < brainStemCount; index += 1) {
      const progress = (index + 0.5) / brainStemCount;
      const radius = 0.078 * (1 - progress) + 0.014;
      const angle = index * goldenAngle;
      positions.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        -0.4 - progress * 0.17,
        Math.sin(angle) * radius * 0.62
      ));
    }

    return positions;
  }

  function createConnectionPairs(positions) {
    const connections = [];
    const maximumDistanceSquared = 0.2 * 0.2;
    const seenConnections = new Set();
    for (let left = 0; left < positions.length; left += 1) {
      const nearest = [];
      for (let right = 0; right < positions.length; right += 1) {
        if (left === right) {
          continue;
        }
        const dx = positions[left].x - positions[right].x;
        const dy = positions[left].y - positions[right].y;
        const dz = positions[left].z - positions[right].z;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared <= maximumDistanceSquared) {
          nearest.push({ right, distanceSquared });
        }
      }
      nearest.sort((first, second) => first.distanceSquared - second.distanceSquared);

      let linked = 0;
      for (const neighbor of nearest) {
        const first = Math.min(left, neighbor.right);
        const second = Math.max(left, neighbor.right);
        const key = `${first}:${second}`;
        if (!seenConnections.has(key)) {
          seenConnections.add(key);
          connections.push([first, second]);
        }
        linked += 1;
        if (linked === 6) {
          break;
        }
      }
    }
    if (connections.length <= performanceLimits.maxConnections) {
      return connections;
    }

    const cappedConnections = [];
    for (let index = 0; index < performanceLimits.maxConnections; index += 1) {
      const sampleIndex = Math.floor(index * connections.length / performanceLimits.maxConnections);
      cappedConnections.push(connections[sampleIndex]);
    }
    return cappedConnections;
  }

  function createEnergyParticlePositions(THREE, nodePositions, connectionPairs) {
    const points = [];
    for (let index = 0; index < performanceLimits.maxActivityPoints; index += 1) {
      const pair = connectionPairs[(index * 37) % Math.max(1, connectionPairs.length)];
      points.push(pair
        ? nodePositions[pair[0]]
        : new THREE.Vector3());
    }
    return points;
  }

  function createConnectionLinePoints(nodePositions, connectionPairs) {
    const points = [];
    for (const [start, end] of connectionPairs) {
      points.push(nodePositions[start], nodePositions[end]);
    }
    return points;
  }

  function updateNeuralNetwork(
    nodeAttribute,
    connectionAttribute,
    colorAttribute,
    nodePositions,
    connectionPairs,
    animatedPositions,
    config,
    elapsed
  ) {
    const motion = config.animated ? config.pulseAmount * 0.18 : 0;
    for (let index = 0; index < nodePositions.length; index += 1) {
      const base = nodePositions[index];
      const phase = elapsed * 1.1 + index * 0.19;
      const x = base.x + Math.sin(phase * 0.63) * motion * 0.65;
      const y = base.y + Math.sin(phase) * motion;
      const z = base.z + Math.cos(phase * 0.82) * motion * 0.8;
      const offset = index * 3;
      animatedPositions[offset] = x;
      animatedPositions[offset + 1] = y;
      animatedPositions[offset + 2] = z;
      nodeAttribute.setXYZ(index, x, y, z);
    }
    nodeAttribute.needsUpdate = true;

    const channels = [
      ((config.color >> 16) & 0xff) / 255,
      ((config.color >> 8) & 0xff) / 255,
      (config.color & 0xff) / 255
    ];
    for (let index = 0; index < connectionPairs.length; index += 1) {
      const [start, end] = connectionPairs[index];
      const startOffset = start * 3;
      const endOffset = end * 3;
      const vertexOffset = index * 2;
      connectionAttribute.setXYZ(
        vertexOffset,
        animatedPositions[startOffset],
        animatedPositions[startOffset + 1],
        animatedPositions[startOffset + 2]
      );
      connectionAttribute.setXYZ(
        vertexOffset + 1,
        animatedPositions[endOffset],
        animatedPositions[endOffset + 1],
        animatedPositions[endOffset + 2]
      );

      const phase = elapsed * 2.6 + index * 0.17;
      const startBrightness = config.animated
        ? 0.16 + (Math.sin(phase) * 0.5 + 0.5) * 0.84
        : 0.48;
      const endBrightness = config.animated
        ? 0.16 + (Math.sin(phase + 1.1) * 0.5 + 0.5) * 0.84
        : 0.48;
      colorAttribute.setXYZ(
        vertexOffset,
        channels[0] * startBrightness,
        channels[1] * startBrightness,
        channels[2] * startBrightness
      );
      colorAttribute.setXYZ(
        vertexOffset + 1,
        channels[0] * endBrightness,
        channels[1] * endBrightness,
        channels[2] * endBrightness
      );
    }
    connectionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  }

  function updateEnergyParticles(geometry, connectionPairs, animatedPositions, count, elapsed) {
    if (!connectionPairs.length || typeof geometry.getAttribute !== "function") {
      return;
    }
    const positions = geometry.getAttribute("position");
    if (!positions || typeof positions.setXYZ !== "function") {
      return;
    }
    for (let index = 0; index < count; index += 1) {
      const pair = connectionPairs[(index * 37) % connectionPairs.length];
      const progress = (elapsed * 0.34 + index / count) % 1;
      const direction = index % 2 === 0 ? progress : 1 - progress;
      const fromOffset = pair[0] * 3;
      const toOffset = pair[1] * 3;
      positions.setXYZ(
        index,
        animatedPositions[fromOffset]
          + (animatedPositions[toOffset] - animatedPositions[fromOffset]) * direction,
        animatedPositions[fromOffset + 1]
          + (animatedPositions[toOffset + 1] - animatedPositions[fromOffset + 1]) * direction,
        animatedPositions[fromOffset + 2]
          + (animatedPositions[toOffset + 2] - animatedPositions[fromOffset + 2]) * direction
      );
    }
    positions.needsUpdate = true;
  }

  function pulseIntensity(config, elapsed, breath) {
    if (config.mode === "warning") {
      return (Math.sin(elapsed * 2.2) > 0.28 ? config.emissiveIntensity : 0.18);
    }
    return config.emissiveIntensity + Math.max(0, breath) * config.pulseAmount * 5;
  }

  function isMobileViewport(windowRef, container) {
    if (typeof windowRef.matchMedia === "function") {
      return windowRef.matchMedia("(max-width: 600px)").matches;
    }
    return (container.clientWidth || 0) <= 600;
  }

  function setMaterialColor(material, color) {
    if (material) {
      setColor(material.color, color);
      setColor(material.emissive, color);
    }
  }

  function setColor(colorObject, color) {
    if (colorObject && typeof colorObject.setHex === "function") {
      colorObject.setHex(color);
    }
  }

  function trackGeometry(geometries, geometry) {
    geometries.add(geometry);
    return geometry;
  }

  function trackMaterial(materials, material) {
    materials.add(material);
    return material;
  }

  return {
    createAgentBrain,
    getPixelRatio,
    mapAgentStatus,
    performanceLimits,
    pulseIntensity,
    updateEnergyParticles,
    statusMap
  };
});
