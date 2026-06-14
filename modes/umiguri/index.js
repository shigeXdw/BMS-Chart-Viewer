(function () {
  "use strict";

  const DIFFICULTIES = [
    ["BASIC", "#43d86b"],
    ["ADVANCED", "#f4c542"],
    ["EXPERT", "#f04e63"],
    ["MASTER", "#9b63ff"],
    ["WORLD'S END", "#d9e0e5"],
    ["ULTIMA", "#ff445d"]
  ];
  const NOTE_TYPES = new Set(["t", "T", "x", "f", "d", "h", "s", "c", "a", "H", "S", "C"]);

  function base36(value) {
    const parsed = parseInt(value, 36);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function airHeight(value) {
    if (!value) return 0;
    const decimal = Number(value);
    return (Number.isFinite(decimal) ? decimal : base36(value)) / 10;
  }

  function commandParts(line) {
    return line.slice(1).split(/\t+/).map((part) => part.trim());
  }

  function barTick(value, measureTicks) {
    const match = String(value).match(/^(-?\d+)'(-?\d+)$/);
    if (!match) return null;
    const bar = Number(match[1]);
    const tick = Number(match[2]);
    return (measureTicks.get(bar) ?? bar * 1920) + tick;
  }

  function buildMeasureTicks(beats, maximumBar) {
    const signatures = new Map([[0, [4, 4]]]);
    for (const beat of beats) signatures.set(beat.bar, [beat.numerator, beat.denominator]);
    const starts = new Map([[0, 0]]);
    let tick = 0;
    let signature = signatures.get(0);
    for (let bar = 0; bar <= maximumBar + 2; bar++) {
      if (signatures.has(bar)) signature = signatures.get(bar);
      starts.set(bar, tick);
      tick += Math.round(480 * signature[0] * 4 / signature[1]);
    }
    return starts;
  }

  function parseNoteBody(body) {
    const type = body[0];
    if (!NOTE_TYPES.has(type)) return null;
    if (type === "c") {
      return {
        type,
        x: body.length >= 3 ? base36(body[1]) : undefined,
        width: body.length >= 3 ? Math.max(1, base36(body[2])) : undefined,
        height: body.length >= 4 ? airHeight(body.slice(3)) : undefined
      };
    }
    if (type === "a") {
      return {
        type,
        x: base36(body[1]),
        width: Math.max(1, base36(body[2])),
        direction: body.slice(3, 5),
        color: body[5] || "N"
      };
    }
    if (type === "S" || type === "C") {
      const compact = body.length === 5;
      return {
        type,
        x: body.length >= 3 ? base36(body[1]) : undefined,
        width: body.length >= 3 ? Math.max(1, base36(body[2])) : undefined,
        height: airHeight(compact ? body[3] : body.slice(3, 5)),
        color: body[compact ? 4 : 5] || "N"
      };
    }
    return {
      type,
      x: body.length >= 3 ? base36(body[1]) : undefined,
      width: body.length >= 3 ? Math.max(1, base36(body[2])) : undefined,
      direction: body[3] || "A",
      color: body[3] || "N"
    };
  }

  function parseUgc(text, name) {
    const headers = {};
    const bpmRows = [];
    const beatRows = [];
    const rawNotes = [];
    const speedRows = [];
    let currentLong = null;
    let currentTimeline = 0;
    let maximumBar = 0;

    for (const source of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = source.trim();
      if (!line || line.startsWith("'")) continue;
      if (line.startsWith("@")) {
        const [command, ...args] = commandParts(line);
        const key = command.toUpperCase();
        if (key === "USETIL") {
          currentTimeline = Number(args[0]) || 0;
        } else if (key === "BPM") bpmRows.push({ position: args[0], bpm: Number(args[1]) });
        else if (key === "BEAT") {
          beatRows.push({
            bar: Number(args[0]),
            numerator: Number(args[1]) || 4,
            denominator: Number(args[2]) || 4
          });
        } else if (key === "SPDMOD") speedRows.push({ position: args[0], speed: Number(args[1]) });
        else if (key === "TIL") speedRows.push({
          timeline: Number(args[0]) || 0,
          position: args[1],
          speed: Number(args[2])
        });
        else headers[key] = args.join("\t");
        continue;
      }
      if (!line.startsWith("#")) continue;
      const colon = line.indexOf(":");
      const legacyChild = line.indexOf(">");
      const separator = colon >= 0 ? colon : legacyChild;
      if (separator < 0) continue;
      const position = line.slice(1, separator);
      const bodyParts = line.slice(separator + 1).split(",");
      const note = parseNoteBody(bodyParts[0]);
      if (!note) continue;
      const absolute = position.includes("'");
      if (absolute) {
        const bar = Number(position.split("'")[0]) || 0;
        maximumBar = Math.max(maximumBar, bar);
        rawNotes.push({
          position,
          note,
          interval: bodyParts[1],
          timeline: currentTimeline,
          children: []
        });
        currentLong = ["T", "h", "s", "H", "S", "C"].includes(note.type)
          ? rawNotes[rawNotes.length - 1]
          : null;
      } else if (currentLong) {
        currentLong.children.push({
          offset: Number(position) || 0,
          note,
          timeline: currentTimeline,
          interval: bodyParts[1]
        });
      }
    }

    for (const row of [...bpmRows, ...speedRows]) {
      maximumBar = Math.max(maximumBar, Number(String(row.position).split("'")[0]) || 0);
    }
    const measureTicks = buildMeasureTicks(beatRows, maximumBar);
    const initialBpm = Number(headers.MAINBPM) || bpmRows.find((row) => row.bpm > 0)?.bpm || 120;
    const bpmChanges = bpmRows
      .map((row) => ({ tick: barTick(row.position, measureTicks), bpm: row.bpm }))
      .filter((row) => row.tick != null && row.bpm > 0)
      .sort((a, b) => a.tick - b.tick);
    if (!bpmChanges.length || bpmChanges[0].tick !== 0) bpmChanges.unshift({ tick: 0, bpm: initialBpm });

    function tickToSeconds(target) {
      let seconds = 0;
      let cursor = 0;
      let bpm = initialBpm;
      for (const change of bpmChanges) {
        if (change.tick <= cursor) {
          bpm = change.bpm;
          continue;
        }
        if (change.tick >= target) break;
        seconds += (change.tick - cursor) / 480 * 60 / bpm;
        cursor = change.tick;
        bpm = change.bpm;
      }
      return seconds + (target - cursor) / 480 * 60 / bpm;
    }

    function secondsToTick(target) {
      let seconds = 0;
      let tick = 0;
      let bpm = initialBpm;
      for (const change of bpmChanges) {
        if (change.tick <= tick) {
          bpm = change.bpm;
          continue;
        }
        const segment = (change.tick - tick) / 480 * 60 / bpm;
        if (seconds + segment >= target) return tick + (target - seconds) * bpm / 60 * 480;
        seconds += segment;
        tick = change.tick;
        bpm = change.bpm;
      }
      return tick + (target - seconds) * bpm / 60 * 480;
    }

    const notes = [];
    const paths = [];
    for (const raw of rawNotes) {
      const tick = barTick(raw.position, measureTicks);
      if (tick == null || raw.note.type === "c") continue;
      const parent = {
        ...raw.note,
        tick,
        beat: tick / 480,
        time: tickToSeconds(tick),
        measure: Number(raw.position.split("'")[0]) || 0,
        lane: Math.max(0, Math.min(15, Math.floor(raw.note.x || 0))),
        timeline: raw.timeline || 0,
        channel: "u0",
        object: "umiguri",
        umiguri: true
      };
      notes.push(parent);
      if (raw.children.length) {
        const points = [parent];
        for (const child of raw.children) {
          const childTick = tick + child.offset;
          points.push({
            ...child.note,
            tick: childTick,
            beat: childTick / 480,
            time: tickToSeconds(childTick),
            x: Number.isFinite(child.note.x) ? child.note.x : parent.x,
            width: Number.isFinite(child.note.width) ? child.note.width : parent.width,
            height: Number.isFinite(child.note.height) ? child.note.height : parent.height,
            timeline: child.timeline || 0
          });
        }
        parent.longStart = true;
        parent.longPair = points[points.length - 1];
        paths.push({ type: parent.type, points, color: parent.color, interval: raw.interval });
      }
    }
    notes.sort((a, b) => a.time - b.time);
    const maximumTick = Math.max(
      measureTicks.get(maximumBar + 1) || 1920,
      ...notes.map((note) => note.longPair?.tick || note.tick)
    );
    const duration = tickToSeconds(maximumTick) + 2;
    const measureStarts = [...measureTicks.values()]
      .filter((tick) => tick <= maximumTick + 1920)
      .map((tick) => tick / 480);
    const bgmOffset = Number(headers.BGMOFS) || 0;
    const wav = new Map();
    const bgmEvents = [];
    if (headers.BGM) {
      wav.set("umiguri-bgm", headers.BGM);
      bgmEvents.push({
        time: Math.max(0, bgmOffset),
        beat: secondsToTick(Math.max(0, bgmOffset)) / 480,
        channel: "01",
        object: "umiguri-bgm",
        audioOffset: Math.max(0, -bgmOffset)
      });
    }
    const bmp = new Map();
    const bgaEvents = [];
    if (headers.BGIMG || headers.JACKET) {
      bmp.set("umiguri-bg", headers.BGIMG || headers.JACKET);
      bgaEvents.push({ time: 0, beat: 0, channel: "04", object: "umiguri-bg" });
    }
    const difficultyIndex = Math.max(0, Math.min(5, Number(headers.DIFF) || 0));
    const style = DIFFICULTIES[difficultyIndex];
    const parsedSpeedChanges = speedRows
      .map((row) => ({
        ...row,
        timeline: row.timeline || 0,
        tick: barTick(row.position, measureTicks)
      }))
      .filter((row) => row.tick != null && Number.isFinite(row.speed))
      .sort((a, b) => a.tick - b.tick);
    const timelineChanges = new Map();
    for (const change of parsedSpeedChanges) {
      if (!timelineChanges.has(change.timeline)) {
        timelineChanges.set(change.timeline, [{ tick: 0, speed: 1, position: 0 }]);
      }
      const rows = timelineChanges.get(change.timeline);
      const previous = rows[rows.length - 1];
      if (change.tick === previous.tick) {
        previous.speed = change.speed;
      } else {
        rows.push({
          ...change,
          position: previous.position + (change.tick - previous.tick) / 480 * previous.speed
        });
      }
    }

    function timelinePosition(tick, timeline = 0) {
      const rows = timelineChanges.get(timeline) || timelineChanges.get(0);
      if (!rows?.length) return tick / 480;
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (rows[middle].tick <= tick) low = middle + 1;
        else high = middle;
      }
      const row = rows[Math.max(0, low - 1)];
      return row.position + (tick - row.tick) / 480 * row.speed;
    }

    return {
      name,
      format: "umiguri",
      header: {
        TITLE: headers.TITLE || name,
        ARTIST: headers.ARTIST || "",
        SUBARTIST: headers.DESIGN ? `charted by ${headers.DESIGN}` : "",
        GENRE: headers.GENRE || "UMIGURI NEXT",
        PLAYLEVEL: headers.LEVEL || headers.CONST || "--",
        BPM: String(initialBpm),
        DIFFICULTY: String(difficultyIndex),
        UMIGURI_DIFFICULTY: style[0],
        UMIGURI_COLOR: style[1]
      },
      base: "UGC v" + (headers.VER || "8"),
      wav,
      bmp,
      events: [...notes, ...bgmEvents],
      playable: notes,
      longNotes: notes.filter((note) => note.longStart),
      paths,
      bpmChanges: bpmChanges.map((change) => ({
        tick: change.tick,
        beat: change.tick / 480,
        time: tickToSeconds(change.tick),
        bpm: change.bpm
      })),
      speedChanges: parsedSpeedChanges,
      timelinePosition,
      duration,
      lanes: 16,
      fieldUnits: 16,
      hasScratch: false,
      beatToSeconds: (beat) => tickToSeconds(beat * 480),
      secondsToBeat: (seconds) => secondsToTick(seconds) / 480,
      measureStarts,
      hitNotes: notes,
      displayNotes: notes,
      bgmEvents,
      keyEvents: [],
      bgaEvents,
      layerEvents: [],
      poorEvents: [],
      noteCount: notes.length,
      umiguri: true
    };
  }

  function project(field, x, y) {
    const t = Math.max(-field.exitDepth, Math.min(1, y));
    const unit = Math.max(0, Math.min(16, x));
    // Reciprocal depth projection: constant movement through the chart world
    // accelerates naturally as it approaches the camera.
    const perspective = t >= 0
      ? t / (field.cameraDepth + (1 - field.cameraDepth) * t)
      : t;
    const halfNear = field.nearWidth / 2;
    const halfFar = field.farWidth / 2;
    const half = halfNear + (halfFar - halfNear) * perspective;
    return {
      x: field.centerX - half + unit / 16 * half * 2,
      y: field.judgeY - perspective * field.depth
    };
  }

  function notePolygon(field, note, distance, thickness) {
    const y0 = Math.max(-field.exitDepth, Math.min(1, distance));
    const y1 = Math.max(-field.exitDepth, Math.min(1, distance + thickness));
    const a = project(field, note.x, y0);
    const b = project(field, note.x + note.width, y0);
    const c = project(field, note.x + note.width, y1);
    const d = project(field, note.x, y1);
    return [a, b, c, d];
  }

  function elevatedPoint(field, point, distance) {
    const projected = project(field, point.x, distance);
    const height = Number.isFinite(point.height) ? point.height : 0;
    const t = Math.max(0, Math.min(1, distance));
    const perspective = t / (field.cameraDepth + (1 - field.cameraDepth) * t);
    const widthScale = 1 + (field.farWidth / field.nearWidth - 1) * perspective;
    // Keep the authored AIR height at the judgement line, then reduce it
    // gently with depth. Matching the lane-width scale directly made AIR
    // paths collapse almost immediately after entering the playfield.
    const heightScale = 1.05 + 0.85 * Math.sqrt(Math.max(0, widthScale));
    const heightOffset = Math.min(
      height * 40 * heightScale,
      Math.max(0, projected.y - 8)
    );
    return {
      x: projected.x,
      y: projected.y - heightOffset
    };
  }

  function fillPolygon(context, points, fill, stroke) {
    context.beginPath();
    points.forEach((point, index) => {
      if (index) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
    });
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 1.5;
      context.stroke();
    }
  }

  function polygonPath(context, points) {
    context.beginPath();
    points.forEach((point, index) => {
      if (index) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
    });
    context.closePath();
  }

  function traceSmooth(context, points, move = true) {
    if (!points.length) return;
    if (move) context.moveTo(points[0].x, points[0].y);
    if (points.length === 1) return;
    for (let index = 1; index < points.length - 1; index++) {
      const point = points[index];
      const next = points[index + 1];
      context.quadraticCurveTo(
        point.x,
        point.y,
        (point.x + next.x) / 2,
        (point.y + next.y) / 2
      );
    }
    const last = points[points.length - 1];
    context.lineTo(last.x, last.y);
  }

  function smoothRibbonPath(context, left, right) {
    context.beginPath();
    traceSmooth(context, left);
    context.lineTo(right[0].x, right[0].y);
    traceSmooth(context, right, false);
    context.closePath();
  }

  const RENDER_PATH_CACHE = new WeakMap();

  function stableRenderPoints(path) {
    if (RENDER_PATH_CACHE.has(path)) return RENDER_PATH_CACHE.get(path);
    RENDER_PATH_CACHE.set(path, path.points);
    return path.points;
  }

  function drawSlideRibbon(context, left, right, time, detailed = true) {
    const renderedLeft = left;
    const renderedRight = right;
    const polygon = [...renderedLeft, ...renderedRight];
    const xs = polygon.map((point) => point.x);
    const ys = polygon.map((point) => point.y);
    const minimumX = Math.min(...xs);
    const maximumX = Math.max(...xs);
    const minimumY = Math.min(...ys);
    const maximumY = Math.max(...ys);
    const shimmer = (Math.sin(time * 3.4) + 1) / 2;
    const fill = detailed
      ? context.createLinearGradient(minimumX, minimumY, maximumX, maximumY)
      : "rgba(48,205,247,.56)";
    if (detailed) {
      fill.addColorStop(0, "rgba(51,206,255,.72)");
      fill.addColorStop(0.24 + shimmer * 0.08, "rgba(225,252,255,.9)");
      fill.addColorStop(0.5, "rgba(35,218,255,.84)");
      fill.addColorStop(0.76 - shimmer * 0.08, "rgba(255,173,239,.78)");
      fill.addColorStop(1, "rgba(71,183,255,.7)");
    }

    context.save();
    context.shadowColor = detailed ? "rgba(75,221,255,.72)" : "transparent";
    context.shadowBlur = detailed ? 10 : 0;
    polygonPath(context, polygon);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = "rgba(190,246,255,.95)";
    context.lineWidth = 1.5;
    context.stroke();
    context.shadowBlur = 0;
    context.restore();

    if (!detailed) return;

    const centers = renderedLeft.map((point, index) => {
      const opposite = renderedRight[renderedRight.length - 1 - index];
      return { x: (point.x + opposite.x) / 2, y: (point.y + opposite.y) / 2 };
    });
    context.save();
    context.lineJoin = "round";
    context.lineCap = "round";
    context.shadowColor = "#d8fbff";
    context.shadowBlur = 9;
    context.strokeStyle = "rgba(229,253,255,.9)";
    context.lineWidth = 2.2;
    context.beginPath();
    centers.forEach((point, index) => {
      if (index) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
    });
    context.stroke();
    context.setLineDash([7, 11]);
    context.lineDashOffset = -time * 28;
    context.shadowBlur = 4;
    context.strokeStyle = "rgba(255,174,239,.72)";
    context.lineWidth = 1.4;
    context.beginPath();
    centers.forEach((point, index) => {
      if (index) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
    });
    context.stroke();
    context.restore();
  }

  function drawHoldCap(context, left, right) {
    const centerY = (left.y + right.y) / 2;
    const extension = Math.max(2, (right.x - left.x) * 0.04);
    context.save();
    context.lineCap = "round";
    context.shadowColor = "#ffd45a";
    context.shadowBlur = 9;
    context.strokeStyle = "#c98500";
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(left.x - extension, centerY);
    context.lineTo(right.x + extension, centerY);
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = "#fff8de";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(left.x, centerY - 1);
    context.lineTo(right.x, centerY - 1);
    context.stroke();
    context.restore();
  }

  function drawHoldRibbon(context, left, right) {
    const polygon = [...left, ...right];
    const ys = polygon.map((point) => point.y);
    const minimumY = Math.min(...ys);
    const maximumY = Math.max(...ys);
    const gradient = context.createLinearGradient(0, minimumY, 0, maximumY);
    gradient.addColorStop(0, "rgba(255,216,51,.94)");
    gradient.addColorStop(0.34, "rgba(255,181,89,.92)");
    gradient.addColorStop(0.7, "rgba(226,93,210,.9)");
    gradient.addColorStop(1, "rgba(255,205,42,.96)");

    context.save();
    context.shadowColor = "rgba(255,197,66,.66)";
    context.shadowBlur = 9;
    fillPolygon(context, polygon, gradient, "rgba(255,239,171,.9)");
    context.restore();

    const startRight = right[right.length - 1];
    const endRight = right[0];
    drawHoldCap(context, left[0], startRight);
    drawHoldCap(context, left[left.length - 1], endRight);
  }

  function drawAirHatching(context, left, right, time) {
    const polygon = [...left, ...right];
    const xs = polygon.map((point) => point.x);
    const ys = polygon.map((point) => point.y);
    const minimumX = Math.min(...xs);
    const maximumX = Math.max(...xs);
    const minimumY = Math.min(...ys);
    const maximumY = Math.max(...ys);
    const spacing = 11;
    const offset = time * 24 % spacing;

    context.save();
    polygonPath(context, polygon);
    context.clip();
    context.strokeStyle = "rgba(183,255,96,.2)";
    context.lineWidth = 1;
    for (let x = minimumX - (maximumY - minimumY) + offset; x < maximumX; x += spacing) {
      context.beginPath();
      context.moveTo(x, maximumY);
      context.lineTo(x + (maximumY - minimumY) * 0.32, minimumY);
      context.stroke();
    }
    context.restore();
  }

  const AIR_ARROW_CACHE = new Map();
  const AIR_ARROW_PHASES = 12;

  function arrowPolygon(center, top, width, height, pointsDown) {
    const half = width / 2;
    const shoulder = width * 0.27;
    if (pointsDown) {
      return [
        { x: center - half, y: top },
        { x: center + half, y: top },
        { x: center + half, y: top + height * 0.48 },
        { x: center + shoulder, y: top + height * 0.48 },
        { x: center, y: top + height },
        { x: center - shoulder, y: top + height * 0.48 },
        { x: center - half, y: top + height * 0.48 }
      ];
    }
    return [
      { x: center, y: top },
      { x: center + shoulder, y: top + height * 0.52 },
      { x: center + half, y: top + height * 0.52 },
      { x: center + half, y: top + height },
      { x: center - half, y: top + height },
      { x: center - half, y: top + height * 0.52 },
      { x: center - shoulder, y: top + height * 0.52 }
    ];
  }

  function createAirArrowSprite(direction, phaseIndex) {
    const down = direction.startsWith("D");
    const horizontal = direction.endsWith("L") ? -1 : direction.endsWith("R") ? 1 : 0;
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    const centerX = 96;
    const baseY = 122;
    const width = 166;
    const height = 108;
    const lean = horizontal * 22;
    const phase = phaseIndex / AIR_ARROW_PHASES;
    const color = down ? [255, 80, 145] : [75, 255, 125];

    context.save();
    context.globalCompositeOperation = "source-over";
    context.shadowColor = `rgb(${color.join(",")})`;
    context.shadowBlur = 9;

    for (let layer = 2; layer >= 0; layer--) {
      const travel = (phase + layer / 3) % 1;
      const layerHeight = height * 0.43;
      const layerWidth = width * (0.76 - travel * 0.14);
      const top = baseY - layerHeight - travel * height * 0.48;
      const center = centerX + lean * (0.35 + travel * 0.65);
      const alpha = 0.07 + (1 - travel) * 0.12;
      fillPolygon(
        context,
        arrowPolygon(center, top, layerWidth, layerHeight, down),
        `rgba(${color.join(",")},${alpha})`,
        `rgba(240,255,248,${alpha + 0.12})`
      );
    }

    context.restore();
    return canvas;
  }

  function airArrowSprite(direction, phaseIndex) {
    const key = `${direction}:${phaseIndex}`;
    if (!AIR_ARROW_CACHE.has(key)) {
      AIR_ARROW_CACHE.set(key, createAirArrowSprite(direction, phaseIndex));
    }
    return AIR_ARROW_CACHE.get(key);
  }

  function drawAirArrow(context, field, note, distance, time) {
    const polygon = notePolygon(field, note, distance, 0.012);
    const anchor = {
      x: (polygon[0].x + polygon[1].x) / 2,
      y: (polygon[0].y + polygon[1].y) / 2
    };
    const direction = String(note.direction || "UC").toUpperCase();
    const phase = (time * 2.8 + note.tick / 480) % 1;
    const phaseIndex = Math.floor(phase * AIR_ARROW_PHASES) % AIR_ARROW_PHASES;
    const sprite = airArrowSprite(direction, phaseIndex);
    const noteWidth = Math.max(1, polygon[1].x - polygon[0].x);
    const targetWidth = Math.max(24, Math.min(190, noteWidth * 0.94));
    const targetHeight = targetWidth * 0.67;
    context.drawImage(
      sprite,
      anchor.x - targetWidth / 2,
      anchor.y - targetHeight,
      targetWidth,
      targetHeight
    );
  }

  function drawAirActionLadder(context, field, visible, time, path) {
    const centers = visible.map(({ point, distance }) => elevatedPoint(field, {
      ...point,
      x: point.x + point.width / 2
    }, distance));
    if (centers.length < 2) return;

    context.save();
    context.globalCompositeOperation = "source-over";
    context.lineJoin = "round";
    context.lineCap = "round";
    context.shadowColor = "#57ff43";
    context.shadowBlur = 12;
    context.strokeStyle = "rgba(88,255,62,.9)";
    context.lineWidth = 5;
    context.beginPath();
    centers.forEach((point, index) => {
      if (index) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
    });
    context.stroke();

    const startTick = path.points[0]?.tick || 0;
    const endTick = path.points[path.points.length - 1]?.tick || startTick;
    const endVisible = visible.some(({ point }) => Math.abs((point.tick || 0) - endTick) < 0.5);
    if (!endVisible) {
      context.restore();
      return;
    }

    const endpoint = visible.reduce((nearest, entry) => (
      Math.abs((entry.point.tick || 0) - endTick) < Math.abs((nearest.point.tick || 0) - endTick)
        ? entry
        : nearest
    ));
    const airLeft = elevatedPoint(field, endpoint.point, endpoint.distance);
    const airRight = elevatedPoint(field, {
      ...endpoint.point,
      x: endpoint.point.x + endpoint.point.width
    }, endpoint.distance);
    const groundLeft = project(field, endpoint.point.x, endpoint.distance);
    const groundRight = project(field, endpoint.point.x + endpoint.point.width, endpoint.distance);
    const airCenter = {
      x: (airLeft.x + airRight.x) / 2,
      y: (airLeft.y + airRight.y) / 2
    };
    const groundCenter = {
      x: (groundLeft.x + groundRight.x) / 2,
      y: (groundLeft.y + groundRight.y) / 2
    };
    const verticalHeight = groundCenter.y - airCenter.y;
    if (verticalHeight < 5) {
      context.restore();
      return;
    }

    const pulse = 0.9 + Math.sin(time * 7) * 0.08;
    context.shadowColor = "#55ff4b";
    context.shadowBlur = 8;
    context.strokeStyle = "rgba(83,255,72,.72)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(airCenter.x, airCenter.y);
    context.lineTo(groundCenter.x, groundCenter.y);
    context.stroke();

    const stepCount = Math.max(4, Math.min(9, Math.round(verticalHeight / 8)));
    for (let index = 0; index < stepCount; index++) {
      const progress = index / stepCount;
      const y = airCenter.y + verticalHeight * progress;
      const centerX = airCenter.x + (groundCenter.x - airCenter.x) * progress;
      const airHalfWidth = (airRight.x - airLeft.x) / 2;
      const groundHalfWidth = (groundRight.x - groundLeft.x) / 2;
      const halfWidth = airHalfWidth + (groundHalfWidth - airHalfWidth) * progress;
      const widthScale = 1 - progress * 0.28;
      const alpha = (0.78 - progress * 0.58) * pulse;
      context.shadowColor = "#d45cff";
      context.shadowBlur = 9 - progress * 5;
      context.strokeStyle = `rgba(210,84,255,${alpha})`;
      context.lineWidth = 4 - progress * 2;
      context.beginPath();
      context.moveTo(centerX - halfWidth * widthScale, y);
      context.lineTo(centerX + halfWidth * widthScale, y);
      context.stroke();
    }

    const capExtension = Math.max(3, (airRight.x - airLeft.x) * 0.05);
    context.shadowColor = "#ff61dc";
    context.shadowBlur = 12;
    context.strokeStyle = "rgba(255,90,222,.96)";
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(airLeft.x - capExtension, airCenter.y);
    context.lineTo(airRight.x + capExtension, airCenter.y);
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(255,238,255,.96)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(airLeft.x, airCenter.y - 1);
    context.lineTo(airRight.x, airCenter.y - 1);
    context.stroke();
    context.restore();
  }

  function clippedPath(points, distanceFor, minimumDistance = 0) {
    const output = [];
    const add = (point, distance) => {
      const previous = output[output.length - 1];
      if (!previous || Math.abs(previous.distance - distance) > 0.00001) {
        output.push({ point, distance });
      }
    };
    const interpolate = (from, to, ratio) => ({
      ...from,
      x: from.x + (to.x - from.x) * ratio,
      width: from.width + (to.width - from.width) * ratio,
      height: (from.height || 0) + ((to.height || 0) - (from.height || 0)) * ratio,
      tick: from.tick + (to.tick - from.tick) * ratio,
      beat: from.beat + (to.beat - from.beat) * ratio,
      time: from.time + (to.time - from.time) * ratio,
      timeline: ratio < 0.5 ? from.timeline : to.timeline
    });

    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1];
      const to = points[index];
      const fromDistance = distanceFor(from);
      const toDistance = distanceFor(to);
      const minimum = Math.min(fromDistance, toDistance);
      const maximum = Math.max(fromDistance, toDistance);
      if (maximum < minimumDistance || minimum > 1 || fromDistance === toDistance) continue;
      const startDistance = Math.max(minimumDistance, minimum);
      const endDistance = Math.min(1, maximum);
      const ratioAt = (distance) => (distance - fromDistance) / (toDistance - fromDistance);
      if (fromDistance <= toDistance) {
        add(interpolate(from, to, ratioAt(startDistance)), startDistance);
        add(interpolate(from, to, ratioAt(endDistance)), endDistance);
      } else {
        add(interpolate(from, to, ratioAt(endDistance)), endDistance);
        add(interpolate(from, to, ratioAt(startDistance)), startDistance);
      }
    }
    return output;
  }

  function drawFlickChevrons(context, field, note, distance) {
    const polygon = notePolygon(field, note, distance, 0.012);
    const left = polygon[0];
    const right = polygon[1];
    const direction = note.direction === "L" ? -1 : 1;
    const width = Math.max(12, right.x - left.x);
    const centerX = polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length;
    const centerY = polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length;
    const noteHeight = Math.max(2, Math.abs(polygon[2].y - polygon[1].y));
    const halfHeight = Math.max(1.25, Math.min(5, noteHeight * 0.28));
    const chevronWidth = Math.max(3.5, Math.min(9, width * 0.09));
    const spacing = Math.max(5, Math.min(16, width / 5));
    context.save();
    context.strokeStyle = "rgba(255,255,255,.96)";
    context.lineWidth = Math.max(1, Math.min(2.4, noteHeight * 0.16));
    context.lineCap = "round";
    context.lineJoin = "round";
    for (let index = -1; index <= 1; index++) {
      const x = centerX + index * spacing;
      context.beginPath();
      context.moveTo(x - direction * chevronWidth, centerY - halfHeight);
      context.lineTo(x + direction * chevronWidth * 0.25, centerY);
      context.lineTo(x - direction * chevronWidth, centerY + halfHeight);
      context.stroke();
    }
    context.restore();
  }

  function drawPlayfield({ context, chart, time, width, height, speed }) {
    const field = {
      centerX: width / 2,
      nearWidth: Math.min(width * 0.96, height * 1.36),
      farWidth: Math.min(width * 0.2, height * 0.3),
      judgeY: height - Math.max(52, height * 0.07),
      depth: height * 0.88,
      cameraDepth: 0.16,
      exitDepth: 0.075,
      airJudgeHeight: 3.2
    };
    const horizonY = field.judgeY - field.depth;
    const gradient = context.createLinearGradient(0, horizonY, 0, field.judgeY);
    gradient.addColorStop(0, "#141529");
    gradient.addColorStop(0.65, "#080b13");
    gradient.addColorStop(1, "#030608");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const corners = [
      project(field, 0, 0), project(field, 16, 0),
      project(field, 16, 1), project(field, 0, 1)
    ];
    fillPolygon(context, corners, "rgba(4,12,18,.94)", "#47cce5");
    for (let unit = 0; unit <= 16; unit += 2) {
      const near = project(field, unit, 0);
      const far = project(field, unit, 1);
      context.strokeStyle = unit === 8 ? "rgba(255,255,255,.78)" : "rgba(184,205,215,.5)";
      context.lineWidth = unit === 8 ? 2.5 : 1.25;
      context.beginPath();
      context.moveTo(near.x, near.y);
      context.lineTo(far.x, far.y);
      context.stroke();
    }

    const currentBeat = chart.secondsToBeat(time);
    const currentTick = currentBeat * 480;
    const beatsVisible = Math.max(3, 24 / Math.max(0.25, speed));
    const noteDistance = (note) => (
      chart.timelinePosition(note.tick, note.timeline)
      - chart.timelinePosition(currentTick, note.timeline)
    ) / beatsVisible;
    for (const beat of chart.measureStarts) {
      const tick = beat * 480;
      const distance = (
        chart.timelinePosition(tick, 0)
        - chart.timelinePosition(currentTick, 0)
      ) / beatsVisible;
      if (distance < 0 || distance > 1) continue;
      const left = project(field, 0, distance);
      const right = project(field, 16, distance);
      context.strokeStyle = "rgba(114,220,238,.32)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left.x, left.y);
      context.lineTo(right.x, right.y);
      context.stroke();
    }

    const visiblePaths = chart.paths
      .filter((path) => !(path.type === "C" && path.color === "Z"))
      .map((path) => ({
        path,
        visible: clippedPath(stableRenderPoints(path), noteDistance, -field.exitDepth)
      }))
      .filter(({ visible }) => visible.length >= 2)
      .sort((a, b) => {
        const nearestA = Math.min(...a.visible.map((entry) => entry.distance));
        const nearestB = Math.min(...b.visible.map((entry) => entry.distance));
        return nearestB - nearestA;
      });

    const isAirType = (type) => ["a", "H", "S", "C"].includes(type);
    const drawVisiblePath = ({ path, visible, detailed = true }, phase = "all") => {
      const air = ["H", "S", "C"].includes(path.type);
      const slide = ["T", "s"].includes(path.type);
      const hold = path.type === "h";
      const groundLeft = visible.map(({ point, distance }) => project(field, point.x, distance));
      const groundRight = visible.map(({ point, distance }) => project(field, point.x + point.width, distance)).reverse();
      if (air && phase !== "body") {
        context.save();
        context.shadowColor = "#000000";
        context.shadowBlur = 16;
        fillPolygon(context, [...groundLeft, ...groundRight], "rgba(0,0,0,.4)", "rgba(112,125,132,.62)");
        context.restore();
      }
      const left = air
        ? visible.map(({ point, distance }) => elevatedPoint(field, point, distance))
        : groundLeft;
      const right = air
        ? visible.map(({ point, distance }) => elevatedPoint(field, {
          ...point,
          x: point.x + point.width
        }, distance)).reverse()
        : groundRight;
      if (air && phase !== "body") {
        const nearGround = groundLeft[0];
        const nearAir = left[0];
        const nearGroundRight = groundRight[groundRight.length - 1];
        const nearAirRight = right[right.length - 1];
        const beamHeight = Math.max(0, Math.min(120, nearGround.y - nearAir.y));
        if (beamHeight > 2) {
          const beamTopY = nearGround.y - beamHeight;
          const beam = context.createLinearGradient(0, beamTopY, 0, nearGround.y);
          beam.addColorStop(0, "rgba(38,43,47,.32)");
          beam.addColorStop(1, "rgba(0,0,0,.05)");
          fillPolygon(context, [
            { x: nearAir.x, y: beamTopY },
            { x: nearAirRight.x, y: beamTopY },
            nearGroundRight,
            nearGround
          ], beam);
        }
      }
      if (phase === "underlay") return;
      if (slide) {
        drawSlideRibbon(context, left, right, time, detailed);
      } else if (hold) {
        drawHoldRibbon(context, left, right);
      } else {
        const airGradient = air
          ? context.createLinearGradient(0, Math.min(...left.map((point) => point.y)), 0, Math.max(...left.map((point) => point.y)))
          : null;
        if (airGradient) {
          airGradient.addColorStop(0, "rgba(84,255,150,.12)");
          airGradient.addColorStop(0.55, "rgba(80,255,184,.3)");
          airGradient.addColorStop(1, "rgba(235,255,248,.56)");
        }
        fillPolygon(
          context,
          [...left, ...right],
          path.type === "S" ? "rgba(48,255,105,.09)"
            : air ? airGradient
              : "rgba(252,213,59,.36)",
          air ? "#60ffbd" : "#ffe757"
        );
        if (air) drawAirHatching(context, left, right, time);
      }
      if (path.type === "S") drawAirActionLadder(context, field, visible, time, path);
    };

    const groundPaths = visiblePaths.filter(({ path }) => !isAirType(path.type));
    const airPaths = visiblePaths.filter(({ path }) => isAirType(path.type));
    const visibleSlides = groundPaths.filter(({ path }) => ["T", "s"].includes(path.type));
    const detailLimit = visibleSlides.length > 80 ? 8 : 18;
    const detailedSlides = new Set(
      visibleSlides
        .sort((a, b) => {
          const nearestA = Math.min(...a.visible.map((entry) => entry.distance));
          const nearestB = Math.min(...b.visible.map((entry) => entry.distance));
          return nearestA - nearestB;
        })
        .slice(0, detailLimit)
        .map(({ path }) => path)
    );
    const cheapSlides = visibleSlides.filter(({ path }) => !detailedSlides.has(path));
    if (cheapSlides.length) {
      context.save();
      context.fillStyle = "rgba(48,205,247,.5)";
      context.strokeStyle = "rgba(173,241,255,.72)";
      context.lineWidth = 1;
      context.beginPath();
      for (const { visible } of cheapSlides) {
        const left = visible.map(({ point, distance }) => project(field, point.x, distance));
        const right = visible
          .map(({ point, distance }) => project(field, point.x + point.width, distance))
          .reverse();
        const polygon = [...left, ...right];
        polygon.forEach((point, index) => {
          if (index) context.lineTo(point.x, point.y);
          else context.moveTo(point.x, point.y);
        });
        context.closePath();
      }
      context.fill();
      context.stroke();
      context.restore();
    }
    airPaths.forEach((entry) => drawVisiblePath(entry, "underlay"));
    groundPaths
      .filter(({ path }) => !["T", "s"].includes(path.type) || detailedSlides.has(path))
      .forEach((entry) => drawVisiblePath(entry));

    const colors = {
      t: ["#f04453", "#ffb1b8"],
      T: ["#279de8", "#b8eeff"],
      x: ["#ffd447", "#fff4c2"],
      f: ["#55d6ff", "#d1f6ff"],
      d: ["#ef3d62", "#ff9aaf"],
      h: ["#ffd83d", "#fff4a0"],
      s: ["#4fe2ff", "#b8f6ff"],
      a: ["#50ff9e", "#c0ffdc"],
      H: ["#50ff9e", "#c0ffdc"],
      S: ["#50ff9e", "#c0ffdc"],
      C: ["#77eaff", "#d0f9ff"]
    };
    const visibleNotes = chart.displayNotes
      .filter((note) => !(note.type === "C" && note.color === "Z"))
      .map((note) => ({ note, distance: noteDistance(note) }))
      .filter(({ distance }) => distance >= -field.exitDepth && distance <= 1)
      .sort((a, b) => b.distance - a.distance);

    const drawVisibleNote = ({ note, distance }) => {
      const palette = colors[note.type] || colors.t;
      const polygon = notePolygon(field, note, distance, 0.012);
      if (note.type === "h") {
        drawHoldCap(context, polygon[0], polygon[1]);
      } else {
        fillPolygon(context, polygon, palette[0], palette[1]);
      }
      if (note.type === "a") {
        drawAirArrow(context, field, note, distance, time);
      } else if (note.type === "f") {
        drawFlickChevrons(context, field, note, distance);
      }
    };

    visibleNotes
      .filter(({ note }) => !isAirType(note.type))
      .forEach(drawVisibleNote);

    const judgeLeft = project(field, 0, 0);
    const judgeRight = project(field, 16, 0);
    context.strokeStyle = "#ffec55";
    context.lineWidth = 4;
    context.shadowColor = "#fff36d";
    context.shadowBlur = 10;
    context.beginPath();
    context.moveTo(judgeLeft.x, judgeLeft.y);
    context.lineTo(judgeRight.x, judgeRight.y);
    context.stroke();
    context.shadowBlur = 0;

    const airJudgeLeft = elevatedPoint(field, { x: 0, height: field.airJudgeHeight }, 0);
    const airJudgeRight = elevatedPoint(field, { x: 16, height: field.airJudgeHeight }, 0);
    context.strokeStyle = "rgba(84,255,190,.92)";
    context.lineWidth = 4;
    context.shadowColor = "#4dffbf";
    context.shadowBlur = 12;
    context.beginPath();
    context.moveTo(airJudgeLeft.x, airJudgeLeft.y);
    context.lineTo(airJudgeRight.x, airJudgeRight.y);
    context.stroke();
    context.shadowBlur = 0;

    airPaths.forEach((entry) => drawVisiblePath(entry, "body"));
    visibleNotes
      .filter(({ note }) => isAirType(note.type))
      .forEach(drawVisibleNote);
  }

  function drawMeasure({ context, chart, notes, width, height, startBeat, endBeat }) {
    context.fillStyle = "#070a10";
    context.fillRect(0, 0, width, height);
    const beatY = (beat) => height - 3 - (beat - startBeat) / Math.max(0.001, endBeat - startBeat) * (height - 6);
    for (let unit = 0; unit <= 16; unit += 2) {
      const x = unit / 16 * width;
      context.strokeStyle = unit === 8 ? "#a9bac4" : "#34434c";
      context.lineWidth = unit === 8 ? 2.5 : 1;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let division = 0; division <= 16; division++) {
      const y = 3 + division / 16 * (height - 6);
      context.strokeStyle = "#202d35";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    for (const path of chart.paths) {
      for (let index = 1; index < path.points.length; index++) {
        const from = path.points[index - 1];
        const to = path.points[index];
        if (to.beat < startBeat || from.beat >= endBeat) continue;
        const fromBeat = Math.max(startBeat, from.beat);
        const toBeat = Math.min(endBeat, to.beat);
        const ratioFrom = (fromBeat - from.beat) / Math.max(0.001, to.beat - from.beat);
        const ratioTo = (toBeat - from.beat) / Math.max(0.001, to.beat - from.beat);
        const interpolate = (a, b, ratio) => a + (b - a) * ratio;
        const x1 = interpolate(from.x, to.x, ratioFrom) / 16 * width;
        const x2 = interpolate(from.x, to.x, ratioTo) / 16 * width;
        const right1 = interpolate(from.x + from.width, to.x + to.width, ratioFrom) / 16 * width;
        const right2 = interpolate(from.x + from.width, to.x + to.width, ratioTo) / 16 * width;
        const y1 = beatY(fromBeat);
        const y2 = beatY(toBeat);
        const air = ["H", "S", "C"].includes(path.type);
        const pathPolygon = [
          { x: x1, y: y1 }, { x: right1, y: y1 },
          { x: right2, y: y2 }, { x: x2, y: y2 }
        ];
        const pathFill = path.type === "h" ? "rgba(255,170,68,.58)"
          : ["T", "s"].includes(path.type) ? "rgba(61,210,255,.5)"
            : path.type === "C" ? "rgba(105,231,255,.38)"
              : air ? "rgba(80,255,158,.38)"
                : "rgba(255,216,61,.42)";
        const pathStroke = path.type === "h" ? "#ff72ce"
          : ["T", "s"].includes(path.type) ? "#d8fbff"
            : path.type === "C" ? "#79ecff"
              : air ? "#5cffad"
                : "#ffe052";
        fillPolygon(context, pathPolygon, pathFill, pathStroke);

        if (path.type === "h") {
          context.strokeStyle = "#fff3c8";
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(x1, y1);
          context.lineTo(right1, y1);
          context.moveTo(x2, y2);
          context.lineTo(right2, y2);
          context.stroke();
        }
      }
    }
    const inspectorColors = {
      t: "#ef4054",
      T: "#43cfff",
      x: "#ffd83f",
      f: "#58d8ff",
      d: "#f14663",
      h: "#ffd347",
      s: "#52dcff",
      a: "#50ff9e",
      H: "#50ff9e",
      S: "#50ff9e",
      C: "#74eaff"
    };
    for (const note of notes) {
      const y = beatY(note.beat);
      const x = note.x / 16 * width;
      const noteWidth = Math.max(2, note.width / 16 * width);
      context.fillStyle = inspectorColors[note.type] || "#ef4054";
      context.fillRect(x, y - 3, noteWidth, 6);
      if (note.type === "f") {
        context.strokeStyle = "#ffffff";
        context.lineWidth = 1;
        context.beginPath();
        const direction = note.direction === "L" ? -1 : 1;
        const centerX = x + noteWidth / 2;
        context.moveTo(centerX - direction * 3, y - 2);
        context.lineTo(centerX + direction * 2, y);
        context.lineTo(centerX - direction * 3, y + 2);
        context.stroke();
      }
    }
  }

  PlayerModes.register({
    id: "umiguri",
    name: "UMIGURI NEXT",
    detect: (file) => /\.ugc$/i.test(file.name),
    async parse(file) {
      return parseUgc(await file.text(), file.name);
    },
    drawPlayfield,
    drawMeasure,
    selectLabel(chart) {
      return `LV ${chart.header.PLAYLEVEL} | 16-Lane | ${chart.header.TITLE} [${chart.header.UMIGURI_DIFFICULTY}]`;
    },
    difficultyStyle(chart) {
      return [chart.header.UMIGURI_DIFFICULTY, chart.header.UMIGURI_COLOR];
    },
    inspectorSubtitle(chart, artist) {
      return `${artist} · UMIGURI NEXT · 16-unit field · ${chart.measureStarts.length - 1} measures`;
    }
  });
})();
