import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
  Dimensions,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHIP_WIDTH = 60;
const SHIP_HEIGHT = 68; // Adjusted to match the actual rendered height of the spaceship components
const SHIP_BOTTOM_OFFSET = 140;
const MOVE_STEP = 30;

const ASTEROID_SIZE = 44;
const SHIP_HITBOX_MARGIN_X = 14;
const SHIP_HITBOX_MARGIN_Y = 14;
const ASTEROID_HITBOX_MARGIN = 8;
const INITIAL_FALL_SPEED = 6;
const MAX_FALL_SPEED = 18;
const GAME_LOOP_INTERVAL = 50;
const INITIAL_SPAWN_INTERVAL = 1200;
const MIN_SPAWN_INTERVAL = 300;

const HIGH_SCORE_KEY = '@SpaceEscapeRunner:highScore';

function getRandomX() {
  return Math.random() * (SCREEN_WIDTH - ASTEROID_SIZE);
}

function getCenteredShipX() {
  return SCREEN_WIDTH / 2 - SHIP_WIDTH / 2;
}

// Reusable hook: gives any button a "press down" squish animation
function useButtonScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () =>
    Animated.spring(scale, { toValue: 0.92, useNativeDriver: true }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  return { scale, onPressIn, onPressOut };
}

export default function App() {
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [shipX, setShipX] = useState(getCenteredShipX());
  const [asteroids, setAsteroids] = useState<{ id: number, x: number, y: number, speed: number }[]>([]);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const gameLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickCounter = useRef(0);
  const lastSpawnTick = useRef(0);
  const asteroidIdCounter = useRef(0);

  // Animated versions of values that need smooth motion
  const shipAnimX = useRef(new Animated.Value(getCenteredShipX())).current;
  const shipCurrentX = useRef(getCenteredShipX());
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const flameAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scorePop = useRef(new Animated.Value(1)).current;

  const startBtn = useButtonScale();
  const leftBtn = useButtonScale();
  const rightBtn = useButtonScale();

  // Smoothly glide the ship to its new X position whenever it changes
  useEffect(() => {
    Animated.spring(shipAnimX, {
      toValue: shipX,
      friction: 6,
      tension: 80,
      useNativeDriver: false, // "left" is a layout property, can't use native driver
    }).start();
  }, [shipX, shipAnimX]);

  // Track the actual visual position of the ship for accurate collision detection
  useEffect(() => {
    const listenerId = shipAnimX.addListener(({ value }) => {
      shipCurrentX.current = value;
    });
    return () => shipAnimX.removeListener(listenerId);
  }, [shipAnimX]);

  // Continuous asteroid rotation, forever, independent of game state
  useEffect(() => {
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 4000,
        useNativeDriver: true,
      })
    ).start();
  }, [rotateAnim]);

  // Continuous engine flame flicker, forever
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(flameAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(flameAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ])
    ).start();
  }, [flameAnim]);

  // Fade in the Game Over overlay
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: isGameOver ? 1 : 0,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [isGameOver, fadeAnim]);

  // Little "pop" on the score every time it increases
  useEffect(() => {
    if (score === 0) return;
    Animated.sequence([
      Animated.timing(scorePop, { toValue: 1.3, duration: 120, useNativeDriver: true }),
      Animated.spring(scorePop, { toValue: 1, useNativeDriver: true }),
    ]).start();
  }, [score, scorePop]);

  // Load saved high score on app start
  useEffect(() => {
    const loadHighScore = async () => {
      try {
        const savedValue = await AsyncStorage.getItem(HIGH_SCORE_KEY);
        if (savedValue !== null) setHighScore(parseInt(savedValue, 10));
      } catch (error) {
        console.log('Failed to load high score', error);
      }
    };
    loadHighScore();
  }, []);

  // Save new high score after game over
  useEffect(() => {
    if (isGameOver && score > highScore) {
      setHighScore(score);
      AsyncStorage.setItem(HIGH_SCORE_KEY, score.toString()).catch((error) =>
        console.log('Failed to save high score', error)
      );
    }
  }, [isGameOver, score, highScore]);

  const handleStartGame = () => {
    setScore(0);
    setShipX(getCenteredShipX());
    setAsteroids([]);
    tickCounter.current = 0;
    lastSpawnTick.current = 0;
    asteroidIdCounter.current = 0;
    setIsGameOver(false);
    setIsPlaying(true);
  };

  const moveLeft = () => setShipX((prevX) => Math.max(prevX - MOVE_STEP, 0));
  const moveRight = () =>
    setShipX((prevX) => Math.min(prevX + MOVE_STEP, SCREEN_WIDTH - SHIP_WIDTH));

  useEffect(() => {
    if (!isPlaying) return;

    gameLoopRef.current = setInterval(() => {
      tickCounter.current += GAME_LOOP_INTERVAL;
      const currentDifficulty = Math.floor(tickCounter.current / 5000); // Increases by 1 every 5s
      const currentSpawnInterval = Math.max(MIN_SPAWN_INTERVAL, INITIAL_SPAWN_INTERVAL - (currentDifficulty * 100));

      setAsteroids((prevAsteroids) => {
        const shipTop = SCREEN_HEIGHT - SHIP_BOTTOM_OFFSET - SHIP_HEIGHT;
        
        // Use the visual ship position rather than the target ship position
        const currentShipX = shipCurrentX.current;
        
        const shipHitboxLeft = currentShipX + SHIP_HITBOX_MARGIN_X;
        const shipHitboxRight = currentShipX + SHIP_WIDTH - SHIP_HITBOX_MARGIN_X;
        const shipHitboxTop = shipTop + SHIP_HITBOX_MARGIN_Y;
        const shipHitboxBottom = shipTop + SHIP_HEIGHT - SHIP_HITBOX_MARGIN_Y;

        let newAsteroids: { id: number, x: number, y: number, speed: number }[] = [];
        let scoreToAdd = 0;
        let collisionDetected = false;

        for (let i = 0; i < prevAsteroids.length; i++) {
          const ast = prevAsteroids[i];
          const newY = ast.y + ast.speed;

          const asteroidHitboxTop = newY + ASTEROID_HITBOX_MARGIN;
          const asteroidHitboxBottom = newY + ASTEROID_SIZE - ASTEROID_HITBOX_MARGIN;
          const asteroidHitboxLeft = ast.x + ASTEROID_HITBOX_MARGIN;
          const asteroidHitboxRight = ast.x + ASTEROID_SIZE - ASTEROID_HITBOX_MARGIN;

          const isOverlappingVertically = asteroidHitboxBottom >= shipHitboxTop && asteroidHitboxTop <= shipHitboxBottom;
          const isOverlappingHorizontally = asteroidHitboxRight >= shipHitboxLeft && asteroidHitboxLeft <= shipHitboxRight;

          if (isOverlappingVertically && isOverlappingHorizontally) {
            collisionDetected = true;
            break;
          }

          if (newY >= SCREEN_HEIGHT) {
            scoreToAdd += 1;
          } else {
            newAsteroids.push({ ...ast, y: newY });
          }
        }

        if (collisionDetected) {
          if (gameLoopRef.current) clearInterval(gameLoopRef.current);
          setIsPlaying(false);
          setIsGameOver(true);
          return prevAsteroids;
        }

        if (scoreToAdd > 0) {
          setScore(prev => prev + scoreToAdd);
        }

        lastSpawnTick.current += GAME_LOOP_INTERVAL;
        if (lastSpawnTick.current >= currentSpawnInterval) {
          lastSpawnTick.current = 0;
          newAsteroids.push({
            id: asteroidIdCounter.current++,
            x: getRandomX(),
            y: -ASTEROID_SIZE,
            speed: Math.min(MAX_FALL_SPEED, INITIAL_FALL_SPEED + Math.random() * 2 + (currentDifficulty * 0.5))
          });
        }

        return newAsteroids;
      });
    }, GAME_LOOP_INTERVAL);

    return () => {
      if (gameLoopRef.current) clearInterval(gameLoopRef.current);
    };
  }, [isPlaying, shipX]);

  const rotateInterpolate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const flameScale = flameAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] });
  const flameOpacity = flameAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  return (
    <LinearGradient
      colors={['#05060F', '#141033', '#241246']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" />

      <Text style={styles.title}>🚀 Space Escape Runner</Text>

      <View style={styles.scoreRow}>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>Score</Text>
          <Animated.Text
            style={[styles.scoreValue, { transform: [{ scale: scorePop }] }]}
          >
            {score}
          </Animated.Text>
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>Best</Text>
          <Text style={styles.highScoreValue}>🏆 {highScore}</Text>
        </View>
      </View>

      {!isPlaying && (
        <Animated.View style={{ transform: [{ scale: startBtn.scale }] }}>
          <TouchableOpacity
            style={styles.startButton}
            onPress={handleStartGame}
            onPressIn={startBtn.onPressIn}
            onPressOut={startBtn.onPressOut}
            activeOpacity={0.9}
          >
            <Text style={styles.startButtonText}>
              {isGameOver ? '🔁 Restart Game' : '▶ Start Game'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {isPlaying && asteroids.map(ast => (
        <Animated.View
          key={ast.id}
          style={[
            styles.asteroid,
            {
              left: ast.x,
              top: ast.y,
              transform: [{ rotate: rotateInterpolate }],
            },
          ]}
        >
          <View style={[styles.crater, styles.craterA]} />
          <View style={[styles.crater, styles.craterB]} />
          <View style={[styles.crater, styles.craterC]} />
        </Animated.View>
      ))}

      {isPlaying && (
        <Animated.View style={[styles.spaceship, { left: shipAnimX }]}>
          <View style={styles.nose} />
          <View style={styles.body}>
            <View style={styles.cockpit} />
          </View>
          <View style={styles.wings}>
            <View style={styles.wingLeft} />
            <View style={styles.wingRight} />
          </View>
          <Animated.View
            style={[
              styles.flame,
              { opacity: flameOpacity, transform: [{ scaleY: flameScale }] },
            ]}
          />
        </Animated.View>
      )}

      {isPlaying && (
        <View style={styles.controls}>
          <Animated.View style={{ transform: [{ scale: leftBtn.scale }] }}>
            <TouchableOpacity
              style={styles.controlButton}
              onPress={moveLeft}
              onPressIn={leftBtn.onPressIn}
              onPressOut={leftBtn.onPressOut}
              activeOpacity={0.9}
            >
              <Text style={styles.controlButtonText}>◀</Text>
            </TouchableOpacity>
          </Animated.View>
          <Animated.View style={{ transform: [{ scale: rightBtn.scale }] }}>
            <TouchableOpacity
              style={styles.controlButton}
              onPress={moveRight}
              onPressIn={rightBtn.onPressIn}
              onPressOut={rightBtn.onPressOut}
              activeOpacity={0.9}
            >
              <Text style={styles.controlButtonText}>▶</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}

      {isGameOver && (
        <Animated.View style={[styles.gameOverOverlay, { opacity: fadeAnim }]}>
          <Text style={styles.gameOverText}>💥 Game Over</Text>
          <Text style={styles.finalScoreText}>Final Score: {score}</Text>
          <Text style={styles.finalHighScoreText}>🏆 Best: {highScore}</Text>
          <TouchableOpacity style={styles.startButton} onPress={handleStartGame} activeOpacity={0.9}>
            <Text style={styles.startButtonText}>🔁 Restart Game</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 26,
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,229,255,0.6)',
    textShadowRadius: 12,
  },
  scoreRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 46,
  },
  scoreBox: {
    backgroundColor: 'rgba(27,31,59,0.75)',
    paddingVertical: 18,
    paddingHorizontal: 28,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.25)',
    shadowColor: '#00E5FF',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  scoreLabel: {
    color: '#8A8FBF',
    fontSize: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  scoreValue: {
    color: '#00E5FF',
    fontSize: 36,
    fontWeight: 'bold',
  },
  highScoreValue: {
    color: '#FFD700',
    fontSize: 24,
    fontWeight: 'bold',
  },
  startButton: {
    backgroundColor: '#00E5FF',
    paddingVertical: 16,
    paddingHorizontal: 50,
    borderRadius: 30,
    shadowColor: '#00E5FF',
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  startButtonText: {
    color: '#0B0E23',
    fontSize: 18,
    fontWeight: 'bold',
  },

  /* Asteroid */
  asteroid: {
    position: 'absolute',
    width: ASTEROID_SIZE,
    height: ASTEROID_SIZE,
    backgroundColor: '#9C7B52',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 24,
    borderWidth: 2,
    borderColor: '#5C4A32',
    shadowColor: '#FF6B6B',
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  crater: {
    position: 'absolute',
    backgroundColor: '#5C4A32',
    borderRadius: 20,
    opacity: 0.6,
  },
  craterA: { width: 10, height: 10, top: 6, left: 8 },
  craterB: { width: 7, height: 7, top: 20, left: 22 },
  craterC: { width: 6, height: 6, top: 10, left: 28 },

  /* Spaceship */
  spaceship: {
    position: 'absolute',
    bottom: SHIP_BOTTOM_OFFSET,
    width: SHIP_WIDTH,
    alignItems: 'center',
  },
  nose: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 22,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#00E5FF',
  },
  body: {
    width: 26,
    height: 32,
    backgroundColor: '#E8ECF5',
    borderRadius: 8,
    marginTop: -2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00E5FF',
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  cockpit: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0B0E23',
    borderWidth: 1.5,
    borderColor: '#00E5FF',
  },
  wings: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: SHIP_WIDTH,
    marginTop: -14,
  },
  wingLeft: {
    width: 0,
    height: 0,
    borderTopWidth: 16,
    borderRightWidth: 18,
    borderTopColor: 'transparent',
    borderRightColor: '#FF6B6B',
  },
  wingRight: {
    width: 0,
    height: 0,
    borderTopWidth: 16,
    borderLeftWidth: 18,
    borderTopColor: 'transparent',
    borderLeftColor: '#FF6B6B',
  },
  flame: {
    width: 10,
    height: 16,
    backgroundColor: '#FFA733',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    marginTop: -2,
  },

  /* Controls */
  controls: {
    position: 'absolute',
    bottom: 40,
    flexDirection: 'row',
    gap: 20,
  },
  controlButton: {
    backgroundColor: 'rgba(27,31,59,0.85)',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,229,255,0.4)',
    shadowColor: '#00E5FF',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  controlButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },

  /* Game Over */
  gameOverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5,6,15,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  gameOverText: {
    fontSize: 38,
    fontWeight: 'bold',
    color: '#FF6B6B',
    marginBottom: 16,
    textShadowColor: 'rgba(255,107,107,0.6)',
    textShadowRadius: 14,
  },
  finalScoreText: {
    fontSize: 20,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  finalHighScoreText: {
    fontSize: 18,
    color: '#FFD700',
    marginBottom: 30,
  },
});
