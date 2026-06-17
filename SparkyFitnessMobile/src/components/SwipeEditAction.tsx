import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';

interface SwipeEditActionProps {
  onPress: () => void;
  disabled?: boolean;
}

const EDIT_ACTION_WIDTH = 80;

// Left-swipe Edit action (mirror of the right-swipe Delete). The swipeable's
// leftActions container is absoluteFill + flex-row + alignItems:stretch, so a
// plain View stretches to the row height and renders className/text reliably -
// but a GHTouchableOpacity neither stretches nor lays out its children well
// there. So the visible full-height blue button (background + centered label)
// is a plain View, and the tap is handled by a transparent GHTouchableOpacity
// overlaid via absoluteFill on top of it. gesture-handler's touchable is
// required because RN TouchableOpacity taps are swallowed inside a
// ReanimatedSwipeable action on Android.
const SwipeEditAction: React.FC<SwipeEditActionProps> = ({ onPress, disabled = false }) => (
  <View className="bg-accent-primary justify-center items-center" style={{ width: EDIT_ACTION_WIDTH }}>
    <Text className="text-accent-text font-semibold text-sm">Edit</Text>
    <GHTouchableOpacity
      testID="swipe-edit-action"
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel="Edit"
      accessibilityRole="button"
      style={StyleSheet.absoluteFill}
    >
      <View style={{ flex: 1 }} />
    </GHTouchableOpacity>
  </View>
);

export default SwipeEditAction;
