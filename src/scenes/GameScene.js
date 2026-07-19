import Phaser from 'phaser'
import Player from '../entities/Player.js'
import { GAME_CONFIG } from '../config.js'

const STATIC_ENEMY_KEYS = [
  'enemy_freedom_of_speech',
  'enemy_peaceful_protest',
  'enemy_press_meet'
]

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene')
  }

  init(data) {
    this.selectedCity = data.city || 'delhi'
  }

  create() {
    this.lives = 3
    this.score = 0
    this.bestScore = Number.parseInt(sessionStorage.getItem('modiManBestScore') || '0', 10)
    this.scrollSpeed = GAME_CONFIG.SCROLL_SPEED_BASE

    const width = this.scale.width
    const height = this.scale.height
    this.physics.world.setBounds(0, 0, width, height)

    // Very dark background
    this.cameras.main.setBackgroundColor('#1a0a2e')

    const baseLayerWidth = 640
    const baseLayerHeight = 360
    const layerScale = Math.max(width / baseLayerWidth, height / baseLayerHeight)
    const groundKey = `${this.selectedCity}_1`
    const groundSource = this.textures.get(groundKey).getSourceImage()
    const groundBaseHeight = groundSource.height
    const groundDisplayHeight = groundBaseHeight * layerScale
    this.groundY = height - groundDisplayHeight

    // Parallax backgrounds. Ground is a cropped strip, so its TileSprite height must match
    // the PNG height; otherwise Phaser tiles it vertically and stacks roads.
    this.bg4 = this.add.tileSprite(0, 0, baseLayerWidth, baseLayerHeight, `${this.selectedCity}_4`).setOrigin(0, 0).setScale(layerScale).setDepth(-4)
    this.bg3 = this.add.tileSprite(0, 0, baseLayerWidth, baseLayerHeight, `${this.selectedCity}_3`).setOrigin(0, 0).setScale(layerScale).setDepth(-3)
    this.bg2 = this.add.tileSprite(0, 0, baseLayerWidth, baseLayerHeight, `${this.selectedCity}_2`).setOrigin(0, 0).setScale(layerScale).setDepth(-2)
    this.bg1 = this.add.tileSprite(0, this.groundY, baseLayerWidth, groundBaseHeight, groundKey).setOrigin(0, 0).setScale(layerScale).setDepth(-1)

    // Enemies group
    this.enemies = this.physics.add.group()
    
    // Spawn timer
    this.time.addEvent({
      delay: 2000,
      callback: this.spawnEnemy,
      callbackScope: this,
      loop: true
    })

    // Floor physics: top edge matches the cropped ground image bounding box.
    const floorHeight = Math.max(groundDisplayHeight, 80)
    const floorY = this.groundY + floorHeight / 2
    this.floor = this.add.rectangle(width / 2, floorY, width + 500, floorHeight, 0x332244)
    this.floor.setAlpha(0)
    this.physics.add.existing(this.floor, true) // static 

    // Character center: physics body bottom now lines up with the road top.
    this.player = new Player(this, 120, this.groundY - 64)
    this.physics.add.collider(this.player, this.floor)
    this.physics.add.overlap(this.player, this.enemies, this.hitEnemy, null, this)

    // Inputs
    this.cursors = this.input.keyboard.createCursorKeys()
    this.keys = {
      X: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X)
    }
    this.touchControls = { fly: false, laser: false, bounds: [] }
    this.input.addPointer(2)
    if (this.isMobileView()) {
      this.createTouchControls(width, height)
      this.createRefreshControl(width)
    }
    this.lastTapAt = 0
    this.input.on('pointerdown', this.handlePointerDown, this)

    // Boot the HUD
    this.scene.launch('HUDScene')
    this.hud = this.scene.get('HUDScene')

    // Slight delay to ensure HUD is created before updating lives
    this.time.delayedCall(100, () => {
        if (this.hud && this.hud.updateLives) {
            this.hud.updateLives(this.lives)
        }
    })
  }

  spawnEnemy() {
    if (this.player.isDead) return
    
    // Spawn between Y=100 and the current city ground top.
    const spawnY = Phaser.Math.Between(100, this.groundY - 50)
    const x = this.scale.width + 100

    if (Phaser.Math.Between(0, STATIC_ENEMY_KEYS.length) === 0) {
      this.spawnCockroachEnemy(x, spawnY)
      return
    }

    const enemyKey = Phaser.Utils.Array.GetRandom(STATIC_ENEMY_KEYS)
    const enemy = this.enemies.create(x, spawnY, enemyKey)
    enemy.body.allowGravity = false
    enemy.setVelocityX(-this.scrollSpeed)
    enemy.setData('hp', GAME_CONFIG.ENEMY_HIT_POINTS || 4)
    enemy.setData('staticEnemy', true)
    enemy.setData('baseY', spawnY)

    this.scaleStaticEnemy(enemy)
    this.addStaticEnemyMotion(enemy)
  }

  spawnCockroachEnemy(x, spawnY) {
    const ufo = this.enemies.create(x, spawnY, 'ufo_hover')
    ufo.body.allowGravity = false
    ufo.setVelocityX(-this.scrollSpeed)
    ufo.setData('hp', GAME_CONFIG.ENEMY_HIT_POINTS || 4)

    ufo.play('ufo_hover_anim', true)
    ufo.body.setSize(80, 80)
    ufo.body.setOffset(24, 24)
  }

  scaleStaticEnemy(enemy) {
    const texture = this.textures.get(enemy.texture.key).getSourceImage()
    const maxWidth = 170
    const maxHeight = 150
    const scale = Math.min(maxWidth / texture.width, maxHeight / texture.height)
    const displayWidth = texture.width * scale
    const displayHeight = texture.height * scale

    enemy.setDisplaySize(displayWidth, displayHeight)
    enemy.body.setSize(texture.width * 0.78, texture.height * 0.78)
    enemy.body.setOffset(texture.width * 0.11, texture.height * 0.11)
  }

  addStaticEnemyMotion(enemy) {
    enemy.setAngle(Phaser.Math.Between(-4, 4))
    this.tweens.add({
      targets: enemy,
      y: enemy.y + Phaser.Math.Between(-10, 10),
      angle: enemy.angle + Phaser.Math.Between(-6, 6),
      scaleX: enemy.scaleX * 1.04,
      scaleY: enemy.scaleY * 0.96,
      duration: Phaser.Math.Between(650, 900),
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
  }

  damageEnemy(enemy, hitX, isBeam = false) {
    if (!enemy.active || enemy.getData('dying')) return

    const currentHp = enemy.getData('hp') || 1
    const nextHp = Math.max(0, currentHp - 1)
    enemy.setData('hp', nextHp)

    if (nextHp > 0) {
      enemy.setTint(0xff9999)
      this.time.delayedCall(120, () => {
        if (enemy && enemy.active) enemy.clearTint()
      })
      enemy.setVelocityX(-this.scrollSpeed * 0.5)
      if (isBeam) this.player.holdLaserAt(hitX, this.time.now + 420)
      return
    }

    enemy.setData('dying', true)
    enemy.body.checkCollision.none = true

    if (enemy.getData('staticEnemy')) {
      this.glitchEnemyAndDestroy(enemy, isBeam ? hitX : enemy.x)
      if (isBeam) this.player.holdLaserAt(hitX, this.time.now + 420)
      return
    }

    enemy.setVelocityX(-this.scrollSpeed * 0.2)
    enemy.play('ufo_explosion_anim', true)
    try { this.sound.play('sfx_ufo_explosion', { volume: 0.6 }) } catch (e) {}
    if (isBeam) this.player.holdLaserAt(hitX, this.time.now + 420)
    this.finishEnemyExplosion(enemy)
  }

  glitchEnemyAndDestroy(enemy, hitX = enemy.x) {
    enemy.setVelocityX(-this.scrollSpeed * 0.1)
    enemy.setTint(0x00ffff)
    enemy.setAlpha(0.9)
    enemy.setBlendMode(Phaser.BlendModes.ADD)

    const glitchBursts = []
    for (let i = 0; i < 4; i++) {
      glitchBursts.push(this.time.delayedCall(i * 45, () => {
        if (!enemy || !enemy.active) return
        enemy.setTint(i % 2 === 0 ? 0xff00ff : 0x00ffff)
        enemy.x += Phaser.Math.Between(-9, 9)
        enemy.y += Phaser.Math.Between(-5, 5)
        enemy.setAlpha(i % 2 === 0 ? 0.45 : 0.9)
      }))
    }

    this.tweens.add({
      targets: enemy,
      x: hitX + 18,
      scaleX: enemy.scaleX * 1.18,
      scaleY: enemy.scaleY * 0.75,
      alpha: 0,
      duration: 220,
      ease: 'Stepped',
      onComplete: () => {
        glitchBursts.forEach(timer => timer.remove(false))
        this.score += 150
        this.updateBestScore()
        if (enemy && enemy.active) enemy.destroy()
      }
    })
  }

  hitEnemyWithLaser(laser, enemy) {
    if (!laser.active || !enemy.active || enemy.getData('dying')) return
    laser.destroy()
    this.damageEnemy(enemy, 0, false)
  }

  hitEnemyWithBeam(enemy, hitX) {
    if (!enemy.active || enemy.getData('dying')) return
    this.damageEnemy(enemy, hitX, true)
  }

  finishEnemyExplosion(enemy) {
    this.time.delayedCall(400, () => {
      if (!enemy) return
      this.score += 150
      this.updateBestScore()
      enemy.destroy()
    })
  }

  updateBestScore() {
    const score = Math.floor(this.score)
    if (score <= this.bestScore) return

    this.bestScore = score
    sessionStorage.setItem('modiManBestScore', String(score))
  }

  getBeamTarget(ray) {
    let target = null
    let hitX = Number.POSITIVE_INFINITY

    this.enemies.getChildren().forEach(enemy => {
      if (!enemy.active || enemy.getData('dying')) return

      const body = enemy.body || {}
      const box = {
        left: body.x != null ? body.x : enemy.x - 45,
        right: body.x != null ? body.x + body.width : enemy.x + 45,
        top: body.y != null ? body.y : enemy.y - 40,
        bottom: body.y != null ? body.y + body.height : enemy.y + 40
      }

      const verticalHit = ray.startY >= box.top && ray.startY <= box.bottom
      const horizontalHit = box.right >= ray.startX && box.left <= ray.endX
      if (!verticalHit || !horizontalHit) return

      const candidateHitX = Math.max(box.left, ray.startX)
      if (candidateHitX < hitX) {
        hitX = candidateHitX
        target = enemy
      }
    })

    return target ? { enemy: target, hitX } : null
  }

  handlePointerDown(pointer) {
    if (!this.player || this.player.isDead) return
    if (this.isTouchControlPointer(pointer)) return

    const now = pointer.event?.timeStamp || this.time.now
    if (now - this.lastTapAt <= 300) {
      this.player.shootLaser()
      this.lastTapAt = 0
      return
    }

    this.lastTapAt = now
  }

  isMobileView() {
    const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
    return this.sys.game.device.input.touch || isCoarse || window.innerWidth <= 900
  }

  isTouchControlPointer(pointer) {
    if (!this.touchControls || !this.touchControls.bounds) return false

    return this.touchControls.bounds.some(control => {
      const dx = pointer.x - control.x
      const dy = pointer.y - control.y
      return dx * dx + dy * dy <= control.radius * control.radius
    })
  }

  createTouchControls(width, height) {
    const radius = Math.max(52, Math.min(64, width * 0.16))
    const y = height - 94

    this.createTouchButton(104, y, radius, 'FLY', 'fly')
    this.createTouchButton(width - 104, y, radius, 'LASER', 'laser')
  }

  createRefreshControl(width) {
    const c = this.add.container(width - 58, 58).setDepth(101)
    const bg = this.add.circle(0, 0, 34, 0x15172a, 0.58)
    const ring = this.add.graphics()
    ring.lineStyle(2, 0xffe7a8, 0.65)
    ring.strokeCircle(0, 0, 34)
    const text = this.add.text(0, 0, 'R', {
      fontFamily: 'Rajdhani, Arial, sans-serif',
      fontSize: '22px',
      fontStyle: '700',
      color: '#fff8e6'
    }).setOrigin(0.5).setResolution(2)
    const hit = this.add.circle(0, 0, 42, 0xffffff, 0)
    c.add([bg, ring, text, hit])
    this.touchControls.bounds.push({ x: width - 58, y: 58, radius: 48 })
    hit.setInteractive()
    hit.on('pointerdown', () => window.location.reload())
  }

  createTouchButton(x, y, radius, label, key) {
    const c = this.add.container(x, y).setDepth(100)
    const bg = this.add.circle(0, 0, radius, key === 'fly' ? 0x00ffcc : 0xff3048, 0.18)
    const ring = this.add.graphics()
    ring.lineStyle(3, key === 'fly' ? 0x00ffcc : 0xff3048, 0.55)
    ring.strokeCircle(0, 0, radius)
    const text = this.add.text(0, 0, label, {
      fontFamily: 'Rajdhani, Arial, sans-serif',
      fontSize: key === 'fly' ? '22px' : '18px',
      fontStyle: '700',
      color: '#fff8e6',
      letterSpacing: 2
    }).setOrigin(0.5).setResolution(2)
    const hit = this.add.circle(0, 0, radius + 8, 0xffffff, 0)
    c.add([bg, ring, text, hit])
    this.touchControls.bounds.push({ x, y, radius: radius + 16 })

    const setPressed = pressed => {
      this.touchControls[key] = pressed
      c.setScale(pressed ? 0.94 : 1)
      bg.setAlpha(pressed ? 0.34 : 0.18)
    }

    hit.setInteractive()
    hit.on('pointerdown', pointer => {
      this.touchControls[`${key}PointerId`] = pointer.id
      setPressed(true)
    })
    hit.on('pointerup', pointer => {
      if (this.touchControls[`${key}PointerId`] === pointer.id) setPressed(false)
    })
    hit.on('pointerout', pointer => {
      if (this.touchControls[`${key}PointerId`] === pointer.id) setPressed(false)
    })
  }

  hitEnemy(player, enemy) {
    if (player.isDead || player.isInvincible) return

    if (enemy.getData('staticEnemy') && !enemy.getData('dying')) {
      enemy.setData('dying', true)
      enemy.body.checkCollision.none = true
      this.glitchEnemyAndDestroy(enemy, enemy.x)
    }

    player.x = Phaser.Math.Clamp(player.x, 120, 180)
    player.body.setVelocityX(0)

    // Player took real damage
    if (player.takeHit() === false) {
        this.lives--
        if (this.hud && this.hud.updateLives) {
            this.hud.updateLives(this.lives)
        }
        
        this.cameras.main.shake(150, 0.005)

        if (this.lives <= 0) {
            this.updateBestScore()
            player.die()
            this.add.text(this.scale.width / 2, this.scale.height / 2, 'GAME OVER', {
              fontSize: '64px',
              fill: '#ff0000',
              fontStyle: 'bold'
            }).setOrigin(0.5).setDepth(10)

            this.time.delayedCall(2000, () => {
              this.scene.start('MenuScene')
            })
        }
    }
  }

  update(time, delta) {
    if (!this.player.isDead) {
      const dt = delta / 1000
      const controls = {
        space: { isDown: this.cursors.space.isDown || this.touchControls.fly }
      }
      const keys = {
        X: { isDown: this.keys.X.isDown || this.touchControls.laser }
      }
      this.player.update(controls, keys, delta)
      
      // Update Parallax Backgrounds. Divide by layer scale because TileSprite scrolls in source pixels.
      this.bg1.tilePositionX += (this.scrollSpeed * dt * 1.0) / this.bg1.scaleX
      this.bg2.tilePositionX += (this.scrollSpeed * dt * 0.6) / this.bg2.scaleX
      this.bg3.tilePositionX += (this.scrollSpeed * dt * 0.3) / this.bg3.scaleX
      this.bg4.tilePositionX += (this.scrollSpeed * dt * 0.1) / this.bg4.scaleX
      
      // Update Enemies
      this.enemies.getChildren().forEach(enemy => {
        if (enemy.body && !enemy.body.checkCollision.none && !enemy.getData('dying')) enemy.setVelocityX(-this.scrollSpeed)
        if (enemy.x < -100) {
          enemy.destroy()
        }
      })

      const ray = this.player.getLaserRay()
      if (ray) {
        const beamTarget = this.getBeamTarget(ray)
        if (beamTarget) {
          this.hitEnemyWithBeam(beamTarget.enemy, beamTarget.hitX)
        } else {
          this.player.setLaserEndX(this.scale.width + 80)
        }
      }
      
      // Speed Ramp
      if (this.scrollSpeed < GAME_CONFIG.SCROLL_SPEED_MAX) {
          const expectedSpeed = GAME_CONFIG.SCROLL_SPEED_BASE + (Math.floor(this.score / 500) * GAME_CONFIG.SPEED_RAMP_PER_500PTS * this.scrollSpeed)
          if(expectedSpeed > this.scrollSpeed) {
              this.scrollSpeed += 1 // Increment to smooth transition, basic implementation
          }
      }
    }

    if (this.hud) {
      this.hud.updateScore(this.score)
      if (this.player) this.hud.updateLaser(this.player.laserCharge)
    }

  }
}
