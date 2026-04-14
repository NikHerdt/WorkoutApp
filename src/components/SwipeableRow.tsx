import React, { useRef } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../theme/colors';

const DELETE_WIDTH = 72;
const REVEAL_THRESHOLD = DELETE_WIDTH * 0.4;

interface SwipeableRowProps {
  children: React.ReactNode;
  onDelete: () => void;
}

export default function SwipeableRow({ children, onDelete }: SwipeableRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  // Track position separately so pan handlers can read it synchronously.
  const positionRef = useRef(0);
  const gestureStartX = useRef(0);

  const snapTo = (toValue: number) => {
    positionRef.current = toValue;
    Animated.spring(translateX, {
      toValue,
      useNativeDriver: true,
      bounciness: 4,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        const isHorizontal = Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5;
        const isSwipingLeft = gs.dx < -6;
        const isSwipingRight = gs.dx > 6 && positionRef.current < 0;
        return isHorizontal && (isSwipingLeft || isSwipingRight);
      },
      onPanResponderGrant: () => {
        translateX.stopAnimation();
        gestureStartX.current = positionRef.current;
      },
      onPanResponderMove: (_, gs) => {
        const next = Math.min(0, Math.max(-DELETE_WIDTH, gestureStartX.current + gs.dx));
        positionRef.current = next;
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, gs) => {
        const finalX = gestureStartX.current + gs.dx;
        snapTo(finalX < -REVEAL_THRESHOLD ? -DELETE_WIDTH : 0);
      },
      onPanResponderTerminate: () => snapTo(0),
    })
  ).current;

  return (
    <View style={styles.container}>
      {/* Delete button sits behind the row */}
      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={styles.deleteAction}
          onPress={() => { snapTo(0); onDelete(); }}
          activeOpacity={0.8}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>

      {/* Front row — solid background so it always covers the delete button */}
      <Animated.View
        style={[styles.front, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  actionContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: DELETE_WIDTH,
  },
  deleteAction: {
    flex: 1,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  front: {
    // Solid background ensures the front always fully covers the delete button,
    // even when the child row has a semi-transparent background (e.g. warmup rows).
    backgroundColor: colors.surface,
  },
});
