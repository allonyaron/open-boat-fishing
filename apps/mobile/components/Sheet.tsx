import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { color } from "@/constants/nativeTokens";

const SCREEN_HEIGHT = Dimensions.get("window").height;

/**
 * A detent bottom sheet — square corners, drag-to-dismiss, backdrop tap to dismiss.
 * No bottom-sheet library is installed in this app; this is a small hand-rolled
 * stand-in for UISheetPresentationController detents (frames 02/03/W1).
 */
export function Sheet({
  visible,
  detent = 0.62,
  onClose,
  children,
}: {
  visible: boolean;
  /** Fraction of screen height the sheet occupies. */
  detent?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const sheetHeight = SCREEN_HEIGHT * detent;
  const translateY = useRef(new Animated.Value(sheetHeight)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 14,
      }).start();
    }
  }, [visible, translateY]);

  const dismiss = () => {
    Animated.timing(translateY, {
      toValue: sheetHeight,
      duration: 200,
      useNativeDriver: true,
    }).start(onClose);
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > sheetHeight * 0.25 || g.vy > 1.2) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 80,
            friction: 14,
          }).start();
        }
      },
    }),
  ).current;

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={dismiss} />
      <Animated.View
        style={[s.sheet, { height: sheetHeight, transform: [{ translateY }] }]}
      >
        <View {...panResponder.panHandlers} style={s.grabberZone}>
          <View style={s.grabber} />
        </View>
        <View style={s.content}>{children}</View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(13,28,38,0.45)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: color.white,
  },
  grabberZone: {
    paddingTop: 8,
    paddingBottom: 4,
    alignItems: "center",
  },
  grabber: {
    width: 36,
    height: 4,
    backgroundColor: color.rule,
  },
  content: {
    flex: 1,
  },
});
