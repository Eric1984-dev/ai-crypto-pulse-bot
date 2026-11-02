const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const agentBrain = require("../js/agent-brain.js");

function createContainer() {
  return {
    attributes: {},
    dataset: {},
    innerHTML: "",
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
}

function decodeRgbPng(buffer) {
  const chunks = [];
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.toString("ascii", offset, offset + 4);
    offset += 4;
    const data = buffer.subarray(offset, offset + length);
    offset += length + 4;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  assert.equal(bitDepth, 8);
  assert.equal(colorType, 2);
  const channels = 3;
  const stride = width * channels;
  const scanlines = zlib.inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(height * stride);

  function paethPredictor(left, up, upperLeft) {
    const estimate = left + up - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
      return left;
    }
    return upDistance <= upperLeftDistance ? up : upperLeft;
  }

  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (stride + 1);
    const filter = scanlines[scanlineOffset];
    for (let x = 0; x < stride; x += 1) {
      const value = scanlines[scanlineOffset + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels
        ? pixels[(y - 1) * stride + x - channels]
        : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paethPredictor(left, up, upperLeft)
                : NaN;
      assert.ok(Number.isFinite(predictor), `Unsupported PNG filter ${filter}`);
      pixels[y * stride + x] = (value + predictor) & 255;
    }
  }

  return { width, height, pixels, stride, channels };
}

function getRoutePoints(route) {
  let x = 0;
  let y = 0;
  const points = [];
  for (const command of route.match(/[MLHV][^MLHV]+/g) || []) {
    const values = command.slice(1).trim().split(/\s+/).map(Number);
    if (command[0] === "M" || command[0] === "L") {
      [x, y] = values;
    } else if (command[0] === "H") {
      x = values[0];
    } else {
      y = values[0];
    }
    points.push({ x, y });
  }
  return points;
}

function hasVisibleTraceNear(image, viewX, viewY) {
  const x = Math.round(viewX * image.width / 1254);
  const y = Math.round(viewY * image.height / 1254);
  for (let dy = -5; dy <= 5; dy += 1) {
    for (let dx = -5; dx <= 5; dx += 1) {
      const sampleX = x + dx;
      const sampleY = y + dy;
      if (sampleX < 0 || sampleY < 0 || sampleX >= image.width || sampleY >= image.height) {
        continue;
      }
      const offset = sampleY * image.stride + sampleX * image.channels;
      const red = image.pixels[offset];
      const green = image.pixels[offset + 1];
      const blue = image.pixels[offset + 2];
      if (blue > 90 && blue > red * 1.35 && blue >= green * 0.9) {
        return true;
      }
    }
  }
  return false;
}

test("Agent Status maps known and unknown states to explicit circuit activity", () => {
  const expectedStates = {
    ACTIVE: { signalCount: 12, color: "#5b9cff", signalDuration: 3.2 },
    ANALYZING: { signalCount: 32, color: "#a8d0ff", signalDuration: 2.6 },
    IDLE: { signalCount: 2, color: "#7188a6", signalDuration: 7.5 },
    STOPPED: { signalCount: 0, color: "#75808d", signalDuration: 0 },
    ERROR: { signalCount: 6, color: "#ff6478", signalDuration: 2.4 },
    UNKNOWN: { signalCount: 0, color: "#75808d", signalDuration: 0 }
  };

  for (const [status, expected] of Object.entries(expectedStates)) {
    const config = agentBrain.mapAgentStatus(status);
    assert.equal(config.status, status);
    assert.equal(config.signalCount, expected.signalCount);
    assert.equal(config.color, expected.color);
    assert.equal(config.signalDuration, expected.signalDuration);
  }
  assert.equal(agentBrain.mapAgentStatus("  analyzing ").status, "ANALYZING");
  assert.equal(agentBrain.mapAgentStatus("not-a-status").status, "UNKNOWN");
  assert.equal(agentBrain.mapAgentStatus(null).status, "UNKNOWN");
});

test("circuit SVG uses blue AI artwork and boundary-origin moving signals", () => {
  const container = createContainer();
  const stateElement = { dataset: {} };
  const circuit = agentBrain.createAgentBrain({
    container,
    stateElement,
    initialStatus: "ACTIVE"
  });

  assert.equal(circuit.available, true);
  assert.equal(circuit.isAvailable(), true);
  assert.equal(stateElement.dataset.state, "active");
  assert.equal(
    container.attributes["aria-label"],
    "Agent circuit visualization; status ACTIVE"
  );
  assert.match(container.innerHTML, /viewBox="0 0 1254 1254"/);
  assert.match(container.innerHTML, /class="circuit-board-image" href="\/assets\/agent-circuit-board\.png"/);
  assert.match(container.innerHTML, /class="circuit-chip-analyzing-glow"[^>]+filter="url\(#circuit-chip-analyzing-glow\)"/);
  assert.doesNotMatch(container.innerHTML, /<text\b|INPUT BUS|OUTPUT BUS|DATA BUS/);
  assert.match(container.innerHTML, /class="circuit-flow circuit-flow--analyzing"/);
  assert.match(container.innerHTML, /<animateMotion[^>]+path="M/);
  assert.match(container.innerHTML, /<animate attributeName="opacity" values="1;1;0" keyTimes="0;0\.88;1"/);
  assert.match(
    container.innerHTML,
    /class="circuit-neuron-terminal"[^>]+filter="url\(#circuit-neuron-glow\)">\s*<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0\.84;0\.9;0\.98;1"/
  );
  assert.match(container.innerHTML, /class="circuit-neuron-halo" r="22"/);
  assert.match(container.innerHTML, /class="circuit-neuron-core" r="8"/);
  assert.equal(agentBrain.signalRoutes.length, 32);
  assert.equal(new Set(agentBrain.signalRoutes).size, 32);
  assert.ok(agentBrain.signalRoutes.every((route) => /^M\d+ \d+(?=[VHL])(?:(?:V|H)\d+|L\d+ \d+)+$/.test(route)));
  assert.match(container.innerHTML, /<mask id="circuit-trace-mask"[^>]+mask-type="luminance">/);
  assert.match(container.innerHTML, /mask="url\(#circuit-trace-mask\)"/);
  assert.equal((container.innerHTML.match(/<mask id="circuit-neuron-route-\d+"/g) || []).length, 32);
  assert.equal(
    (container.innerHTML.match(/class="circuit-neuron-track" mask="url\(#circuit-neuron-route-\d+\)"/g) || []).length,
    52
  );
  assert.equal((container.innerHTML.match(/class="circuit-neuron-node"/g) || []).length, 24);
  assert.equal((container.innerHTML.match(/class="circuit-neuron-terminal"/g) || []).length, 52);
  assert.match(container.innerHTML, /<path d="M\d+ \d+[VHL]/);
  const circuitArtwork = fs.readFileSync(path.join(__dirname, "..", "assets", "agent-circuit-board.png"));
  assert.ok(circuitArtwork.length > 100000);
  assert.equal(circuitArtwork.readUInt32BE(16), 1024);
  assert.equal(circuitArtwork.readUInt32BE(20), 1024);
  const routeStarts = agentBrain.signalRoutes.map((route) => {
    const [, x, y] = route.match(/^M([\d.]+)\s([\d.]+)/);
    return { x: Number(x), y: Number(y) };
  });
  assert.ok(routeStarts.every(({ x, y }) => Math.max(Math.abs(x - 627), Math.abs(y - 627)) >= 100));
  const routeDirections = new Set(agentBrain.signalRoutes.map((route) => {
    const points = getRoutePoints(route);
    const start = points[0];
    const end = points[points.length - 1];
    return Math.abs(end.x - start.x) > Math.abs(end.y - start.y)
      ? (end.x < start.x ? "left" : "right")
      : (end.y < start.y ? "up" : "down");
  }));
  assert.deepEqual(routeDirections, new Set(["up", "down", "left", "right"]));
  for (const [status, expectedCount] of Object.entries({
    ACTIVE: 12,
    ANALYZING: 32,
    IDLE: 2,
    STOPPED: 0,
    ERROR: 6,
    UNKNOWN: 0
  })) {
    const statusClass = status.toLowerCase();
    assert.ok(container.innerHTML.includes(`class="circuit-flow circuit-flow--${statusClass}"`));
    const signalGroups = container.innerHTML.match(
      new RegExp(`<g class="circuit-neuron circuit-neuron--${statusClass}"`, "g")
    );
    assert.equal(signalGroups?.length || 0, expectedCount);
  }
  const analyzingRoutes = Array.from(
    container.innerHTML.matchAll(
      /<g class="circuit-neuron circuit-neuron--analyzing">([\s\S]*?)<\/g>/g
    ),
    ([, markup]) => markup.match(/path="([^"]+)"/)?.[1]
  );
  assert.equal(new Set(analyzingRoutes).size, 32);

  circuit.dispose();
});

test("neuron routes follow visible circuit traces and fade near the artwork edges", () => {
  const artwork = fs.readFileSync(path.join(__dirname, "..", "assets", "agent-circuit-board.png"));
  const image = decodeRgbPng(artwork);
  const container = createContainer();
  const circuit = agentBrain.createAgentBrain({ container, initialStatus: "ANALYZING" });
  const nodes = Array.from(
    container.innerHTML.matchAll(/class="circuit-neuron-node" cx="([\d.]+)" cy="([\d.]+)"/g),
    ([, x, y]) => ({ x: Number(x), y: Number(y) })
  );
  assert.equal(nodes.length, 24);
  const missingNodes = nodes.filter((node) => !hasVisibleTraceNear(image, node.x, node.y));
  assert.deepEqual(missingNodes, [], "neuron nodes must remain on visible circuit traces");
  circuit.dispose();

  for (const route of agentBrain.signalRoutes) {
    const points = getRoutePoints(route);
    let sampleCount = 0;
    let visibleSamples = 0;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 8));
      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        const x = start.x + (end.x - start.x) * progress;
        const y = start.y + (end.y - start.y) * progress;
        sampleCount += 1;
        if (hasVisibleTraceNear(image, x, y)) {
          visibleSamples += 1;
        }
      }
    }

    const endpoint = points[points.length - 1];
    const edgeDistance = Math.min(
      endpoint.x,
      endpoint.y,
      1254 - endpoint.x,
      1254 - endpoint.y
    ) * image.width / 1254;
    assert.ok(visibleSamples / sampleCount >= 0.8, `${route} does not follow a visible trace`);
    assert.ok(edgeDistance <= 20, `${route} does not fade near the artwork edge`);
  }
});

test("status updates keep accessibility and activity state synchronized", () => {
  const container = createContainer();
  const stateElement = { dataset: {} };
  const circuit = agentBrain.createAgentBrain({ container, stateElement });

  const analyzing = circuit.setStatus("ANALYZING");
  assert.equal(analyzing.signalCount, 32);
  assert.equal(stateElement.dataset.state, "analyzing");
  assert.equal(
    container.attributes["aria-label"],
    "Agent circuit visualization; status ANALYZING"
  );

  const stopped = circuit.setStatus("STOPPED");
  assert.equal(stopped.signalCount, 0);
  assert.equal(stateElement.dataset.state, "stopped");
  assert.equal(
    container.attributes["aria-label"],
    "Agent circuit visualization; status STOPPED"
  );
  circuit.dispose();
});

test("circuit renderer handles missing containers and disposes safely", () => {
  const unavailable = agentBrain.createAgentBrain();
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.isAvailable(), false);

  const container = createContainer();
  const circuit = agentBrain.createAgentBrain({ container });
  circuit.dispose();
  circuit.dispose();
  assert.equal(circuit.isAvailable(), false);
  assert.equal(container.innerHTML, "");
  assert.throws(() => circuit.setStatus("ACTIVE"), /disposed Agent Status visualization/);
});

test("reduced-motion styling leaves the circuit static and visible", () => {
  const stylesPath = path.join(__dirname, "..", "css", "styles.css");
  const styles = fs.readFileSync(stylesPath, "utf8");
  const brainSource = fs.readFileSync(path.join(__dirname, "..", "js", "agent-brain.js"), "utf8");
  const brainBlock = styles.match(/\.agent-brain\s*\{([\s\S]*?)\n\}/);
  const reducedMotionBlock = styles.match(
    /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
  );

  assert.ok(brainBlock);
  assert.match(brainBlock[1], /background:\s*transparent;/);
  assert.doesNotMatch(brainBlock[1], /border(?:-radius)?:/);
  assert.ok(reducedMotionBlock);
  assert.match(reducedMotionBlock[1], /\.circuit-flow\s*\{\s*display:\s*none\s*!important;/);
  assert.match(styles, /\.circuit-flow--analyzing/);
});

test("the chip has a subtle default glow and status neurons have stronger halos", () => {
  const stylesPath = path.join(__dirname, "..", "css", "styles.css");
  const styles = fs.readFileSync(stylesPath, "utf8");
  const brainSource = fs.readFileSync(path.join(__dirname, "..", "js", "agent-brain.js"), "utf8");
  const boardImage = styles.match(/\.circuit-board-image\s*\{([\s\S]*?)\n\}/);
  const chipGlow = styles.match(/\.circuit-chip-analyzing-glow\s*\{([\s\S]*?)\n\}/);
  const signalHalo = styles.match(/\.circuit-neuron-halo\s*\{([\s\S]*?)\n\}/);
  const analyzingHalo = styles.match(/\.circuit-neuron--analyzing \.circuit-neuron-halo\s*\{([\s\S]*?)\n\}/);
  const errorHalo = styles.match(/\.circuit-neuron--error \.circuit-neuron-halo\s*\{([\s\S]*?)\n\}/);

  assert.ok(boardImage);
  assert.match(boardImage[1], /opacity:\s*0\.62;/);
  assert.match(boardImage[1], /saturate\(1\.1\)/);
  assert.ok(chipGlow);
  assert.match(chipGlow[1], /opacity:\s*0\.18;/);
  assert.ok(signalHalo);
  assert.match(signalHalo[1], /opacity:\s*1;/);
  assert.match(signalHalo[1], /drop-shadow\(0 0 18px #7cb7ff\)/);
  assert.match(signalHalo[1], /drop-shadow\(0 0 40px rgb\(91 156 255 \/ 96%\)\)/);
  assert.ok(analyzingHalo);
  assert.match(analyzingHalo[1], /drop-shadow\(0 0 48px rgb\(91 156 255 \/ 100%\)\)/);
  assert.ok(errorHalo);
  assert.match(errorHalo[1], /drop-shadow\(0 0 36px rgb\(255 100 120 \/ 94%\)\)/);
  assert.match(brainSource, /feGaussianBlur stdDeviation="10" result="blur"/);
  assert.match(
    styles,
    /\.agent-brain-stage\s*\{[^}]*box-shadow:[\s\S]*?rgb\(91 156 255 \/ 8%\)/s
  );
  assert.match(chipGlow[1], /stroke:\s*var\(--accent\);/);
});

test("ANALYZING adds a stronger chip glow while desktop keeps the circuit compact", () => {
  const stylesPath = path.join(__dirname, "..", "css", "styles.css");
  const styles = fs.readFileSync(stylesPath, "utf8");
  const brainSource = fs.readFileSync(path.join(__dirname, "..", "js", "agent-brain.js"), "utf8");
  const desktopBlock = styles.match(/@media \(min-width: 900px\)\s*\{([\s\S]*?)\n\}/);
  const analyzingGlow = styles.match(
    /\.agent-brain\[data-state="analyzing"\] \.circuit-chip-analyzing-glow\s*\{([\s\S]*?)\n\}/
  );

  assert.ok(desktopBlock);
  assert.match(desktopBlock[1], /\.agent-brain-stage\s*\{\s*width:\s*min\(100%,\s*440px\);/);
  assert.ok(analyzingGlow);
  assert.match(analyzingGlow[1], /opacity:\s*0\.58;/);
  assert.match(analyzingGlow[1], /drop-shadow\(0 0 14px rgb\(91 156 255 \/ 45%\)\)/);
  assert.match(
    brainSource,
    /class="circuit-chip-analyzing-glow"[^>]+stroke-width="14" filter="url\(#circuit-chip-analyzing-glow\)"/
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.circuit-chip-analyzing-glow\s*\{\s*transition:\s*none;/
  );
});
