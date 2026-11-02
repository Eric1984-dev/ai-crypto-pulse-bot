const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
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

test("Agent Status maps known and unknown states to explicit circuit activity", () => {
  const expectedStates = {
    ACTIVE: { signalCount: 16, color: "#c780f0", signalDuration: 3.2 },
    ANALYZING: { signalCount: 36, color: "#ed9cff", signalDuration: 1.25 },
    IDLE: { signalCount: 3, color: "#8f76a1", signalDuration: 7.5 },
    STOPPED: { signalCount: 0, color: "#75808d", signalDuration: 0 },
    ERROR: { signalCount: 8, color: "#ff6478", signalDuration: 2.4 },
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

test("circuit SVG includes detailed traces, vias, chips, and route-bound moving signals", () => {
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
  assert.match(container.innerHTML, /viewBox="0 0 1000 360"/);
  assert.equal((container.innerHTML.match(/class="circuit-trace circuit-trace--/g) || []).length, 44);
  assert.equal((container.innerHTML.match(/class="circuit-via-ring"/g) || []).length, 32);
  assert.equal((container.innerHTML.match(/class="circuit-chip"/g) || []).length, 11);
  assert.doesNotMatch(container.innerHTML, /<text\b|INPUT BUS|OUTPUT BUS|DATA BUS/);
  assert.match(container.innerHTML, /class="circuit-flow circuit-flow--analyzing"/);
  assert.match(container.innerHTML, /<animateMotion[^>]+path="M/);
  assert.equal(agentBrain.signalRoutes.length, 32);
  for (const [status, expectedCount] of Object.entries({
    ACTIVE: 16,
    ANALYZING: 36,
    IDLE: 3,
    STOPPED: 0,
    ERROR: 8,
    UNKNOWN: 0
  })) {
    const flow = container.innerHTML.match(new RegExp(
      `<g class="circuit-flow circuit-flow--${status.toLowerCase()}"[^>]*>([\\s\\S]*?)<\\/g>`
    ));
    assert.ok(flow, `${status} flow group exists`);
    assert.equal((flow[1].match(/<animateMotion\b/g) || []).length, expectedCount);
  }

  circuit.dispose();
});

test("status updates keep accessibility and activity state synchronized", () => {
  const container = createContainer();
  const stateElement = { dataset: {} };
  const circuit = agentBrain.createAgentBrain({ container, stateElement });

  const analyzing = circuit.setStatus("ANALYZING");
  assert.equal(analyzing.signalCount, 36);
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
  const reducedMotionBlock = styles.match(
    /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
  );

  assert.ok(reducedMotionBlock);
  assert.match(reducedMotionBlock[1], /\.circuit-flow\s*\{\s*display:\s*none\s*!important;/);
  assert.match(styles, /\.circuit-flow--analyzing/);
});
