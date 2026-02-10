// skills.menu — WebGL background: Watch Dogs 2 inspired triangulated network mesh
(function () {
  const C = document.getElementById('bg-canvas');
  if (!C) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const gl = C.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return;

  // ─── Shaders ───

  const pointVS = `
    attribute vec2 aPos;
    attribute float aSize;
    attribute vec4 aColor;
    varying vec4 vColor;
    void main(){
      gl_Position = vec4(aPos, 0.0, 1.0);
      gl_PointSize = aSize;
      vColor = aColor;
    }`;

  const pointFS = `
    precision highp float;
    varying vec4 vColor;
    void main(){
      vec2 uv = gl_PointCoord - vec2(0.5);
      float d = length(uv);
      if(d > 0.5) discard;
      float outerHaze = smoothstep(0.5, 0.2, d);
      float innerGlow = smoothstep(0.28, 0.04, d);
      float core = smoothstep(0.1, 0.0, d);
      vec3 col = vColor.rgb * 0.12 * outerHaze
               + vColor.rgb * 0.55 * innerGlow
               + (vColor.rgb + vec3(0.35)) * core;
      gl_FragColor = vec4(col, outerHaze * vColor.a);
    }`;

  const lineVS = `
    attribute vec2 aPos;
    attribute vec4 aColor;
    varying vec4 vColor;
    void main(){
      gl_Position = vec4(aPos, 0.0, 1.0);
      vColor = aColor;
    }`;

  const lineFS = `
    precision highp float;
    varying vec4 vColor;
    void main(){
      gl_FragColor = vColor;
    }`;

  const triVS = lineVS;
  const triFS = lineFS;

  function mkShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  function mkProgram(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, mkShader(vs, gl.VERTEX_SHADER));
    gl.attachShader(p, mkShader(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p);
    return p;
  }

  const progPoint = mkProgram(pointVS, pointFS);
  const progLine = mkProgram(lineVS, lineFS);
  const progTri = mkProgram(triVS, triFS);

  const pA = {
    pos: gl.getAttribLocation(progPoint, 'aPos'),
    size: gl.getAttribLocation(progPoint, 'aSize'),
    color: gl.getAttribLocation(progPoint, 'aColor'),
  };
  const lnA = {
    pos: gl.getAttribLocation(progLine, 'aPos'),
    color: gl.getAttribLocation(progLine, 'aColor'),
  };
  const trA = {
    pos: gl.getAttribLocation(progTri, 'aPos'),
    color: gl.getAttribLocation(progTri, 'aColor'),
  };

  const buf = {};
  ['pPos', 'pSize', 'pCol', 'lPos', 'lCol', 'tPos', 'tCol'].forEach(
    (k) => (buf[k] = gl.createBuffer())
  );

  // Brand palette
  const PAL = [
    [0.243, 0.812, 0.557], // green
    [0.957, 0.447, 0.714], // pink
    [0.984, 0.573, 0.235], // orange
    [0.133, 0.827, 0.933], // cyan
    [0.655, 0.545, 0.988], // purple
  ];

  const mob = window.innerWidth < 768;
  const N = mob ? 45 : 90;
  const CONN_DIST = mob ? 0.24 : 0.22;

  const nodes = [];
  for (let i = 0; i < N; i++) {
    const pal = PAL[Math.floor(Math.random() * PAL.length)];
    let sz, alpha, tier;
    if (i < 6) {
      tier = 0;
      sz = mob ? 7 : 12;
      alpha = 0.75;
    } else if (i < 22) {
      tier = 1;
      sz = mob ? 3.5 : 6;
      alpha = 0.45;
    } else {
      tier = 2;
      sz = mob ? 1.5 : 2.5;
      alpha = 0.12;
    }
    nodes.push({
      x: (Math.random() * 2 - 1) * 0.93,
      y: (Math.random() * 2 - 1) * 0.93,
      vx: (Math.random() - 0.5) * 0.00035,
      vy: (Math.random() - 0.5) * 0.00035,
      sz,
      alpha,
      tier,
      col: pal,
      phase: Math.random() * Math.PI * 2,
      pSpd: 0.15 + Math.random() * 0.25,
    });
  }

  const pkts = [];
  const MAX_PKT = mob ? 10 : 24;

  function spawnPkt(a, b) {
    if (pkts.length >= MAX_PKT) return;
    pkts.push({
      f: a,
      t: b,
      p: 0,
      spd: 0.003 + Math.random() * 0.007,
      col: a.col,
    });
  }

  function resize() {
    C.width = innerWidth * dpr;
    C.height = innerHeight * dpr;
    C.style.width = innerWidth + 'px';
    C.style.height = innerHeight + 'px';
    gl.viewport(0, 0, C.width, C.height);
  }
  resize();
  addEventListener('resize', resize);

  let mx = 999,
    my = 999;
  addEventListener('mousemove', (e) => {
    mx = (e.clientX / innerWidth) * 2 - 1;
    my = -((e.clientY / innerHeight) * 2 - 1);
  });
  addEventListener('mouseleave', () => {
    mx = 999;
    my = 999;
  });

  let t = 0,
    spawnT = 0,
    lastNow = performance.now();

  function findTriangles(edges, N) {
    const adj = new Array(N);
    for (let i = 0; i < N; i++) adj[i] = new Set();
    for (const [a, b] of edges) {
      adj[a].add(b);
      adj[b].add(a);
    }
    const tris = [];
    const seen = new Set();
    for (const [a, b] of edges) {
      for (const c of adj[a]) {
        if (c > b && adj[b].has(c)) {
          const key = a * 10000 * 10000 + b * 10000 + c;
          if (!seen.has(key)) {
            seen.add(key);
            tris.push([a, b, c]);
          }
        }
      }
    }
    return tris;
  }

  function frame(now) {
    const dt = Math.min((now - lastNow) / 1000, 0.05);
    lastNow = now;
    t += dt;
    spawnT += dt;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    const asp = C.width / C.height;
    const scl = C.width / 900;

    // Physics
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      const dx = n.x - mx,
        dy = n.y - my;
      const md = Math.sqrt(dx * dx + dy * dy);
      if (md < 0.3 && md > 0.001) {
        const f = 0.000025 / (md * md);
        n.vx += (dx / md) * f;
        n.vy += (dy / md) * f;
      }
      n.vx -= n.x * 0.000012;
      n.vy -= n.y * 0.000012;
      const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (sp > 0.0006) {
        n.vx = (n.vx / sp) * 0.0006;
        n.vy = (n.vy / sp) * 0.0006;
      }
      if (n.x < -0.98 || n.x > 0.98) n.vx *= -0.8;
      if (n.y < -0.98 || n.y > 0.98) n.vy *= -0.8;
      n.x = Math.max(-1, Math.min(1, n.x));
      n.y = Math.max(-1, Math.min(1, n.y));
    }

    // Build connections
    const edges = [];
    const edgeAlphas = [];
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        if (nodes[i].tier === 2 && nodes[j].tier === 2) continue;
        const dx = (nodes[i].x - nodes[j].x) * asp;
        const dy = nodes[i].y - nodes[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < CONN_DIST) {
          const a = 1 - d / CONN_DIST;
          edges.push([i, j]);
          edgeAlphas.push(a);
        }
      }
    }

    // Draw triangle fills
    const tris = findTriangles(edges, N);
    if (tris.length > 0) {
      const tPos = [],
        tCol = [];
      for (const [a, b, c] of tris) {
        const na = nodes[a],
          nb = nodes[b],
          nc2 = nodes[c];
        const r = (na.col[0] + nb.col[0] + nc2.col[0]) / 3;
        const g = (na.col[1] + nb.col[1] + nc2.col[1]) / 3;
        const bl = (na.col[2] + nb.col[2] + nc2.col[2]) / 3;
        const fillA = 0.018;
        tPos.push(na.x, na.y, nb.x, nb.y, nc2.x, nc2.y);
        tCol.push(r, g, bl, fillA, r, g, bl, fillA, r, g, bl, fillA);
      }
      gl.useProgram(progTri);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.tPos);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tPos), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(trA.pos);
      gl.vertexAttribPointer(trA.pos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.tCol);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tCol), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(trA.color);
      gl.vertexAttribPointer(trA.color, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, tris.length * 3);
    }

    // Draw edge lines
    if (edges.length > 0) {
      const lPos = [],
        lCol = [];
      for (let e = 0; e < edges.length; e++) {
        const [i, j] = edges[e];
        const a = edgeAlphas[e];
        const ni = nodes[i],
          nj = nodes[j];
        const r = (ni.col[0] + nj.col[0]) / 2;
        const g = (ni.col[1] + nj.col[1]) / 2;
        const bl = (ni.col[2] + nj.col[2]) / 2;
        const la = a * 0.06;
        lPos.push(ni.x, ni.y, nj.x, nj.y);
        lCol.push(r, g, bl, la, r, g, bl, la);
      }
      gl.useProgram(progLine);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.lPos);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lPos), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(lnA.pos);
      gl.vertexAttribPointer(lnA.pos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.lCol);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lCol), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(lnA.color);
      gl.vertexAttribPointer(lnA.color, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, edges.length * 2);
    }

    // Draw nodes
    const nPos = [],
      nSize = [],
      nCol = [];
    for (const n of nodes) {
      const pulse = Math.sin(t * n.pSpd + n.phase) * 0.1 + 0.9;
      nPos.push(n.x, n.y);
      nSize.push(n.sz * pulse * scl);
      nCol.push(n.col[0], n.col[1], n.col[2], n.alpha * pulse);
    }
    gl.useProgram(progPoint);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nPos), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(pA.pos);
    gl.vertexAttribPointer(pA.pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pSize);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nSize), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(pA.size);
    gl.vertexAttribPointer(pA.size, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pCol);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nCol), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(pA.color);
    gl.vertexAttribPointer(pA.color, 4, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, N);

    // Spawn & draw routing packets
    if (spawnT > 0.3 && edges.length > 0) {
      spawnT = 0;
      const idx = Math.floor(Math.random() * edges.length);
      const e = edges[idx];
      if (edgeAlphas[idx] > 0.15) {
        const dir = Math.random() > 0.5;
        spawnPkt(
          nodes[dir ? e[0] : e[1]],
          nodes[dir ? e[1] : e[0]]
        );
      }
    }

    for (let i = pkts.length - 1; i >= 0; i--) {
      pkts[i].p += pkts[i].spd;
      if (pkts[i].p >= 1) pkts.splice(i, 1);
    }

    if (pkts.length > 0) {
      const pp = [],
        ps = [],
        pc = [];
      for (const p of pkts) {
        const x = p.f.x + (p.t.x - p.f.x) * p.p;
        const y = p.f.y + (p.t.y - p.f.y) * p.p;
        const fade = Math.sin(p.p * Math.PI);
        pp.push(x, y);
        ps.push((mob ? 4 : 5.5) * scl);
        pc.push(p.col[0], p.col[1], p.col[2], fade * 0.65);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pPos);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pp), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(pA.pos);
      gl.vertexAttribPointer(pA.pos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pSize);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ps), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(pA.size);
      gl.vertexAttribPointer(pA.size, 1, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pCol);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pc), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(pA.color);
      gl.vertexAttribPointer(pA.color, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, pkts.length);
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
