const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const mainMenu = document.getElementById('main-menu');
const hud = document.getElementById('hud');
const progressFill = document.getElementById('progress-fill');
const attemptSpan = document.getElementById('attempt-count');
const crashFlash = document.getElementById('crash-flash');
const modeDisplay = document.getElementById('mode-display');

canvas.width = 1280;
canvas.height = 640;

let lastTime = 0;
let accumulator = 0;
const STEP = 1/60;
let animationFrameId;

// --- PHYSICS (UNTOUCHED) ---
const PHY = {
    GRAVITY: 0.65,
    JUMP_FORCE: -10.5,
    SHIP_LIFT: -0.35,
    SHIP_GRAVITY: 0.25,
    UFO_JUMP: -9,        
    ROBOT_JUMP_MIN: -6.5, 
    WAVE_SPEED: 7,       
    TERMINAL_VEL: 12,
    SPEED: 6.5,
    GROUND: 570,
    BLOCK_SIZE: 40
};

// --- COLORS ---
const BG_COLORS = [
    '#3b5ddb', '#d042da', '#2ecc71', '#c0392b', 
    '#34495e', '#8e44ad', '#3498db', '#e67e22', 
    '#1abc9c', '#f1c40f', '#2c3e50', '#8e44ad',
    '#e74c3c', '#2c3e50', '#800000'
];

let gameState = {
    mode: "MENU",
    levelIndex: 0,
    objects: [],
    cameraX: 0,
    attempts: 1,
    levelLength: 0
};

let player = {
    x: 200, y: 0, w: 30, h: 30,
    dy: 0,
    gamemode: 'CUBE',
    rotation: 0,
    onGround: false,
    dead: false,
    gravityScale: 1,
    robotJumpTimer: 0
};

let input = { hold: false, jumpPressed: false, clickProcessed: false };

// --- LEVEL GEN TOOLS ---
const Gen = {
    cursorX: 0,
    reset: function() { this.cursorX = 500; },
    
    add: function(objs) {
        objs.forEach(o => {
            o.x = o.x * PHY.BLOCK_SIZE;
            o.y = PHY.GROUND - (o.y * PHY.BLOCK_SIZE) - PHY.BLOCK_SIZE;
            if (o.t >= 3 && o.t <= 8) { o.y = 0; o.h = PHY.GROUND; } 
            else { o.h = PHY.BLOCK_SIZE; }
            o.w = PHY.BLOCK_SIZE;
            gameState.objects.push(o);
        });
    },

    // 1. Basic Floor Walk
    cubeWalk: function(length, difficulty) {
        let arr = [];
        for (let i = 0; i < length; i++) {
            this.cursorX += 40;
            arr.push({x: this.cursorX/40, y: 0, t: 1}); // Floor
            if (i % (20 - difficulty) === 0) arr.push({x: this.cursorX/40, y: 1, t: 2}); // Spike
            if (i % (30 - difficulty) === 0) arr.push({x: this.cursorX/40, y: 1, t: 1}); // Block
        }
        this.add(arr);
    },

    // 2. Cube Platforms (NEW) - Jumping between floating blocks
    cubePlatforms: function(count) {
        let arr = [];
        let h = 2;
        for (let i = 0; i < count; i++) {
            this.cursorX += 160; // Gap
            let cx = this.cursorX/40;
            arr.push({x: cx, y: 0, t: 2}); // Floor spike (death)
            
            // Platform
            arr.push({x: cx, y: h, t: 1});
            arr.push({x: cx+1, y: h, t: 1});
            arr.push({x: cx+2, y: h, t: 1});
            
            if (Math.random() > 0.5) h = h === 2 ? 4 : 2; // vary height
        }
        this.add(arr);
    },

    // 3. Ship Tunnel (NERFED & SMOOTHER)
    // tightness: Higher number = BIGGER gap (Gap size = tightness)
    shipTunnel: function(length, tightness) {
        let arr = [];
        let ceilH = 15;
        let floorH = 1;
        
        for (let i = 0; i < length; i++) {
            this.cursorX += 40;
            let cx = this.cursorX/40;

            // Smoother changes (every 5 blocks)
            if (i % 5 === 0) {
                let change = Math.floor(Math.random() * 3) - 1;
                floorH = Math.max(1, Math.min(5, floorH + change));
                // Gap is 'tightness' blocks wide
                ceilH = Math.min(15, floorH + tightness); 
            }

            for(let j=0; j<floorH; j++) arr.push({x: cx, y: j, t: 1});
            for(let k=ceilH; k<16; k++) arr.push({x: cx, y: k, t: 1});
        }
        this.add(arr);
    },

    // 4. Ship Gates (NEW) - Vertical Pillars
    shipGates: function(count) {
        let arr = [];
        for (let i = 0; i < count; i++) {
            this.cursorX += 250;
            let cx = this.cursorX/40;
            let gapY = 3 + Math.floor(Math.random()*6);
            // Bottom Pillar
            for(let j=0; j<gapY; j++) arr.push({x: cx, y: j, t: 1});
            // Top Pillar (Gap of 5)
            for(let k=gapY+5; k<16; k++) arr.push({x: cx, y: k, t: 1});
        }
        this.add(arr);
    },

    // 5. Ball Section
    ballSection: function(length, difficulty) {
        let arr = [];
        for (let i = 0; i < length; i++) {
            this.cursorX += 40;
            let cx = this.cursorX/40;
            arr.push({x: cx, y: 0, t: 1});
            arr.push({x: cx, y: 10, t: 1});
            if (i % (12 - difficulty) === 0) {
                if (Math.random() > 0.5) {
                    arr.push({x: cx, y: 1, t: 2});
                    arr.push({x: cx + 3, y: 9, t: 2});
                } else {
                    arr.push({x: cx, y: 5, t: 1});
                    arr.push({x: cx, y: 6, t: 2});
                    arr.push({x: cx, y: 4, t: 2});
                }
            }
        }
        this.add(arr);
    },

    // 6. UFO Section
    ufoSection: function(gates) {
        let arr = [];
        for (let i = 0; i < gates; i++) {
            this.cursorX += 300; 
            let cx = this.cursorX/40;
            let gapY = 2 + Math.floor(Math.random() * 8);
            for(let j=0; j<=gapY; j++) arr.push({x: cx, y: j, t: 1});
            arr.push({x: cx, y: gapY+1, t: 2}); 
            for(let k=gapY+4; k<16; k++) arr.push({x: cx, y: k, t: 1});
        }
        this.add(arr);
    },

    // 7. Robot Section
    robotSection: function(length) {
        let arr = [];
        for (let i = 0; i < length; i++) {
            this.cursorX += 40;
            let cx = this.cursorX/40;
            arr.push({x: cx, y: 0, t: 1});
            if (i % 8 === 0) arr.push({x: cx, y: 1, t: 1});
            if (i % 25 === 0) { arr.pop(); arr.push({x: cx, y: -1, t: 2}); }
        }
        this.add(arr);
    },
    
    // 8. Wave Section
    waveSection: function(length, tightness) {
        let arr = [];
        let slope = 0;
        let y = 3;
        for (let i = 0; i < length; i++) {
            this.cursorX += 40;
            let cx = this.cursorX/40;
            if (i % 10 === 0) slope = Math.floor(Math.random() * 3) - 1; 
            y += slope;
            if (y < 1) { y=1; slope=1; }
            if (y > 10) { y=10; slope=-1; }
            for(let j=0; j<y; j++) arr.push({x: cx, y: j, t: 1});
            for(let k=y+tightness; k<16; k++) arr.push({x: cx, y: k, t: 1});
        }
        this.add(arr);
    },

    portal: function(type) {
        this.cursorX += 200;
        this.add([{x: this.cursorX/40, y: 5, t: type}]);
        this.cursorX += 200;
    }
};

function buildLevel(index) {
    gameState.objects = [];
    Gen.reset();
    
    // 1. STEREO MADNESS (Basic)
    if (index === 0) { 
        Gen.cubeWalk(200, 1); 
        Gen.portal(3); Gen.shipTunnel(300, 10); // Wide gap 10
        Gen.portal(4); Gen.cubeWalk(400, 2); 
    }
    // 2. BACK ON TRACK (Platforms)
    else if (index === 1) { 
        Gen.cubeWalk(100, 2); 
        Gen.cubePlatforms(10); // Introduce platforms
        Gen.portal(3); Gen.shipTunnel(400, 9); 
        Gen.portal(4); Gen.cubeWalk(350, 2); 
    }
    // 3. POLARGEIST (Ball Intro)
    else if (index === 2) { 
        Gen.cubeWalk(100, 2); 
        Gen.portal(5); Gen.ballSection(400, 2); 
        Gen.portal(3); Gen.shipGates(5); // Gates instead of tunnel
        Gen.portal(4); Gen.cubeWalk(100, 2);
    }
    // 4. DRY OUT (UFO Intro)
    else if (index === 3) { 
        Gen.cubeWalk(100, 3); 
        Gen.portal(5); Gen.ballSection(300, 4); 
        Gen.portal(6); Gen.ufoSection(12); 
        Gen.portal(4); Gen.cubeWalk(200, 3); 
    }
    // 5. BASE AFTER BASE (Long Ship)
    else if (index === 4) { 
        Gen.cubeWalk(100, 3); 
        Gen.portal(3); Gen.shipTunnel(500, 8); 
        Gen.portal(4); Gen.cubePlatforms(15); 
    }
    // 6. CAN'T LET GO (Hard Cube)
    else if (index === 5) { 
        Gen.cubePlatforms(20); 
        Gen.portal(5); Gen.ballSection(400, 5); 
        Gen.portal(4); Gen.cubeWalk(300, 5); 
    }
    // 7. JUMPER (Robot)
    else if (index === 6) { 
        Gen.portal(8); Gen.robotSection(400); 
        Gen.portal(3); Gen.shipTunnel(300, 8); 
        Gen.portal(4); Gen.cubeWalk(200, 4); 
    }
    // 8. TIME MACHINE (Mirror/Ball)
    else if (index === 7) { 
        Gen.cubeWalk(100, 5); 
        Gen.portal(5); Gen.ballSection(400, 6); 
        Gen.portal(8); Gen.robotSection(300); 
        Gen.portal(4); Gen.cubeWalk(200, 5); 
    }
    // 9. CYCLES (Ball Heavy)
    else if (index === 8) { 
        Gen.portal(5); Gen.ballSection(400, 7); 
        Gen.portal(6); Gen.ufoSection(18); 
        Gen.portal(3); Gen.shipGates(8); 
    }
    // 10. XSTEP (Mixed Demon)
    else if (index === 9) { 
        Gen.cubeWalk(100, 5); 
        Gen.portal(3); Gen.shipTunnel(200, 6); 
        Gen.portal(5); Gen.ballSection(200, 8); 
        Gen.portal(6); Gen.ufoSection(10); 
        Gen.portal(7); Gen.waveSection(300, 4); 
        Gen.portal(8); Gen.robotSection(200); 
        Gen.portal(3); Gen.shipTunnel(200, 6); 
        Gen.portal(4); Gen.cubeWalk(100, 6); 
    }
    // 11. CLUTTERFUNK (Complex Ship/Ball)
    else if (index === 10) {
         Gen.cubePlatforms(25);
         Gen.portal(3); Gen.shipTunnel(400, 5); // Tighter
         Gen.portal(5); Gen.ballSection(500, 8);
    }
    // 12. THEORY OF EVERYTHING (Fast Paced)
    else if (index === 11) {
        Gen.cubeWalk(100, 5);
        Gen.portal(6); Gen.ufoSection(25);
        Gen.portal(7); Gen.waveSection(400, 3);
        Gen.portal(8); Gen.robotSection(300);
        Gen.portal(3); Gen.shipGates(12);
        Gen.portal(4); Gen.cubeWalk(200, 7);
    }
    // 13. ELECTROMAN (Tight Gaps)
    else if (index === 12) {
         Gen.cubeWalk(100, 8);
         Gen.portal(3); Gen.shipTunnel(400, 5);
         Gen.portal(4); Gen.cubePlatforms(30);
         Gen.portal(6); Gen.ufoSection(30);
    }
    // 14. CLUBSTEP (Demon)
    else if (index === 13) {
         Gen.portal(3); Gen.shipTunnel(400, 4); // Tight gap 4
         Gen.portal(5); Gen.ballSection(400, 9);
         Gen.portal(6); Gen.ufoSection(40);
         Gen.portal(8); Gen.robotSection(400);
    }
    // 15. ELECTRODYNAMIX (Extreme Speed feel)
    else if (index === 14) {
         Gen.cubeWalk(100, 10);
         Gen.portal(3); Gen.shipTunnel(400, 4);
         Gen.portal(5); Gen.ballSection(300, 10);
         Gen.portal(6); Gen.ufoSection(45);
         Gen.portal(7); Gen.waveSection(500, 3); // Tight wave
    }

    gameState.levelLength = Gen.cursorX + 1000;
    resetPlayer();
}

function bindInput() {
    const handleDown = () => { if (gameState.mode === "PLAYING") { input.hold = true; input.jumpPressed = true; input.clickProcessed = false; } };
    const handleUp = () => { input.hold = false; player.robotJumpTimer = 0; };
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('touchstart', (e) => { e.preventDefault(); handleDown(); }, {passive: false});
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') handleDown(); if (e.code === 'Escape') exitToMenu(); });
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchend', handleUp);
    window.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') handleUp(); });
}

function startLevel(index) {
    gameState.levelIndex = index;
    gameState.attempts = 1;
    attemptSpan.innerText = gameState.attempts;
    buildLevel(index);
    mainMenu.style.display = 'none';
    hud.style.display = 'block';
    gameState.mode = "PLAYING";
    lastTime = performance.now();
    accumulator = 0;
    if(animationFrameId) cancelAnimationFrame(animationFrameId);
    requestAnimationFrame(loop);
}

function resetPlayer() {
    player.x = 200; player.y = PHY.GROUND - player.h; player.dy = 0;
    player.gamemode = 'CUBE'; player.rotation = 0; player.dead = false; player.onGround = true;
    player.gravityScale = 1; gameState.cameraX = 0;
    modeDisplay.innerText = "CUBE"; crashFlash.classList.remove('flash-active');
}

function exitToMenu() {
    gameState.mode = "MENU"; mainMenu.style.display = 'flex'; hud.style.display = 'none';
    cancelAnimationFrame(animationFrameId);
}

function crash() {
    if (player.dead) return;
    player.dead = true; gameState.attempts++; attemptSpan.innerText = gameState.attempts;
    crashFlash.classList.add('flash-active');
    setTimeout(() => crashFlash.classList.remove('flash-active'), 100);
    setTimeout(() => { resetPlayer(); }, 600);
}

function updatePhysics() {
    if (player.dead || gameState.mode !== "PLAYING") return;
    gameState.cameraX += PHY.SPEED;
    let gravity = PHY.GRAVITY * player.gravityScale;

    if (player.gamemode === 'CUBE') {
        player.dy += gravity;
        if (player.onGround && input.hold) { player.dy = PHY.JUMP_FORCE * player.gravityScale; player.onGround = false; }
        if (!player.onGround) player.rotation += 5 * player.gravityScale;
        else player.rotation = Math.round(player.rotation / 90) * 90;
    } 
    else if (player.gamemode === 'SHIP') {
        player.dy += input.hold ? PHY.SHIP_LIFT : PHY.SHIP_GRAVITY;
        player.rotation = player.dy * 2.5;
    }
    else if (player.gamemode === 'BALL') {
        player.dy += gravity;
        if (player.onGround && input.jumpPressed) {
            player.gravityScale *= -1; player.dy = 2 * player.gravityScale; player.onGround = false; input.jumpPressed = false;
        }
        player.rotation += 5 * player.gravityScale;
    }
    else if (player.gamemode === 'UFO') {
        player.dy += gravity;
        if (input.jumpPressed && !input.clickProcessed) { player.dy = PHY.UFO_JUMP; input.clickProcessed = true; input.jumpPressed = false; }
    }
    else if (player.gamemode === 'WAVE') {
        player.dy = input.hold ? -PHY.WAVE_SPEED : PHY.WAVE_SPEED;
        player.rotation = player.dy * 5;
    }
    else if (player.gamemode === 'ROBOT') {
        player.dy += gravity;
        if (player.onGround && input.hold) { player.dy = PHY.ROBOT_JUMP_MIN; player.onGround = false; player.robotJumpTimer = 15; }
        else if (input.hold && player.robotJumpTimer > 0) { player.dy -= 0.5; player.robotJumpTimer--; }
    }

    if (Math.abs(player.dy) > PHY.TERMINAL_VEL) player.dy = PHY.TERMINAL_VEL * Math.sign(player.dy);
    player.y += player.dy;
    if (player.y < -10 || player.y > PHY.GROUND + 10) crash();
    player.onGround = false; 

    if (player.gamemode !== 'WAVE' && player.gamemode !== 'SHIP') {
        if (player.gravityScale === 1 && player.y + player.h >= PHY.GROUND) { player.y = PHY.GROUND - player.h; player.dy = 0; player.onGround = true; }
        else if (player.gravityScale === -1 && player.y <= 0) { player.y = 0; player.dy = 0; player.onGround = true; }
    }

    let startDraw = gameState.cameraX - 100;
    let endDraw = gameState.cameraX + 1400;
    let pRect = { l: gameState.cameraX + player.x + 8, r: gameState.cameraX + player.x + player.w - 8, t: player.y + 8, b: player.y + player.h - 8 };

    for (let i = 0; i < gameState.objects.length; i++) {
        let obj = gameState.objects[i];
        if (obj.x < startDraw) continue;
        if (obj.x > endDraw) break;

        if (pRect.r > obj.x && pRect.l < obj.x + obj.w && pRect.b > obj.y && pRect.t < obj.y + obj.h) {
            if (obj.t === 2) crash();
            if (obj.t >= 3 && obj.t <= 8) {
                switch(obj.t) {
                    case 3: player.gamemode = 'SHIP'; break;
                    case 4: player.gamemode = 'CUBE'; break;
                    case 5: player.gamemode = 'BALL'; break;
                    case 6: player.gamemode = 'UFO'; break;
                    case 7: player.gamemode = 'WAVE'; break;
                    case 8: player.gamemode = 'ROBOT'; break;
                }
                player.gravityScale = 1; modeDisplay.innerText = player.gamemode;
            }
            if (obj.t === 1) {
                if (player.gamemode === 'WAVE') crash();
                let prevY = player.y - player.dy;
                if (player.gravityScale === 1) {
                    if (prevY + player.h <= obj.y + 15 && player.dy >= 0) { player.y = obj.y - player.h; player.dy = 0; player.onGround = true; if (['CUBE','ROBOT'].includes(player.gamemode)) player.rotation = Math.round(player.rotation / 90) * 90; } 
                    else if (prevY >= obj.y + obj.h - 15 && player.dy < 0) { player.y = obj.y + obj.h; player.dy = 0; } 
                    else { crash(); }
                } else { 
                    if (prevY >= obj.y + obj.h - 15 && player.dy <= 0) { player.y = obj.y + obj.h; player.dy = 0; player.onGround = true; } 
                    else { crash(); }
                }
            }
        }
    }
    if (gameState.cameraX > gameState.levelLength) exitToMenu();
    let pct = Math.min((gameState.cameraX / gameState.levelLength) * 100, 100);
    if(progressFill) progressFill.style.width = pct + '%';
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let bgCol = BG_COLORS[gameState.levelIndex] || '#001133';
    ctx.fillStyle = bgCol; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000'; ctx.fillRect(0, PHY.GROUND, canvas.width, canvas.height - PHY.GROUND);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, PHY.GROUND); ctx.lineTo(canvas.width, PHY.GROUND); ctx.stroke();

    let startDraw = gameState.cameraX - 100;
    let endDraw = gameState.cameraX + 1400;

    gameState.objects.forEach(obj => {
        if (obj.x < startDraw || obj.x > endDraw) return;
        let drawX = obj.x - gameState.cameraX;
        if (obj.t === 1) { 
            ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.strokeRect(drawX, obj.y, obj.w, obj.h);
            ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(drawX, obj.y, obj.w, obj.h);
        } else if (obj.t === 2) { 
            ctx.fillStyle = 'red'; ctx.strokeStyle = 'white'; ctx.lineWidth = 1; ctx.beginPath();
            if (player.gravityScale === 1) { ctx.moveTo(drawX, obj.y + obj.h); ctx.lineTo(drawX + obj.w/2, obj.y); ctx.lineTo(drawX + obj.w, obj.y + obj.h); } 
            else { ctx.moveTo(drawX, obj.y); ctx.lineTo(drawX + obj.w/2, obj.y + obj.h); ctx.lineTo(drawX + obj.w, obj.y); }
            ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (obj.t >= 3) { 
            let colors = {3:'pink', 4:'cyan', 5:'orange', 6:'purple', 7:'blue', 8:'white'};
            ctx.fillStyle = colors[obj.t] || 'gray'; ctx.globalAlpha = 0.5; ctx.fillRect(drawX, 0, 40, obj.h);
            ctx.globalAlpha = 1.0; ctx.fillStyle = 'white'; ctx.font = "bold 12px Arial"; 
            let names = {3:'SHIP', 4:'CUBE', 5:'BALL', 6:'UFO', 7:'WAVE', 8:'ROBOT'}; ctx.fillText(names[obj.t], drawX, 50);
        }
    });

    if (!player.dead) {
        ctx.save();
        ctx.translate(player.x + player.w/2, player.y + player.h/2);
        ctx.rotate(player.rotation * Math.PI / 180);
        
        // --- CUSTOM ICONS ---
        if (player.gamemode === 'CUBE') {
            ctx.fillStyle = '#00ffff'; ctx.fillRect(-15, -15, 30, 30);
            ctx.strokeStyle = 'black'; ctx.lineWidth = 2; ctx.strokeRect(-10, -10, 20, 20);
            ctx.fillStyle = 'black'; ctx.fillRect(5, -5, 5, 5); // Eye
        }
        else if (player.gamemode === 'SHIP') {
            ctx.fillStyle = '#ff55aa';
            ctx.beginPath(); ctx.moveTo(15, 0); ctx.quadraticCurveTo(0, 15, -15, 0); ctx.lineTo(-15, -10); ctx.lineTo(15, -10); ctx.fill();
            ctx.fillStyle = 'cyan'; ctx.fillRect(-5, -5, 10, 10); // Cockpit
        }
        else if (player.gamemode === 'BALL') {
            ctx.fillStyle = '#ffaa00';
            ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = 'white'; ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(10, 10); ctx.moveTo(10, -10); ctx.lineTo(-10, 10); ctx.stroke();
        }
        else if (player.gamemode === 'UFO') {
            ctx.fillStyle = '#aa00ff';
            ctx.beginPath(); ctx.ellipse(0, 5, 15, 8, 0, 0, Math.PI*2); ctx.fill(); // Base
            ctx.fillStyle = 'cyan'; ctx.beginPath(); ctx.arc(0, -5, 8, Math.PI, 0); ctx.fill(); // Dome
        }
        else if (player.gamemode === 'WAVE') {
            ctx.fillStyle = '#00ff00';
            ctx.beginPath(); ctx.moveTo(-15, -10); ctx.lineTo(15, 0); ctx.lineTo(-15, 10); ctx.fill();
            ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
        }
        else if (player.gamemode === 'ROBOT') {
            ctx.fillStyle = '#eeeeee'; ctx.fillRect(-10, -15, 20, 25); // Body
            ctx.fillStyle = 'red'; ctx.fillRect(-5, -5, 10, 5); // Visor
            ctx.strokeStyle = 'gray'; ctx.strokeRect(-10, -15, 20, 25);
        }

        ctx.restore();
    }
}

function loop(timestamp) {
    if (gameState.mode !== "PLAYING") return;
    if (!lastTime) lastTime = timestamp;
    let deltaTime = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (deltaTime > 0.1) deltaTime = 0.1;
    accumulator += deltaTime;
    while (accumulator >= STEP) { updatePhysics(); accumulator -= STEP; }
    draw();
    animationFrameId = requestAnimationFrame(loop);
}

bindInput();
ctx.fillStyle = '#001133'; ctx.fillRect(0,0,canvas.width,canvas.height);
