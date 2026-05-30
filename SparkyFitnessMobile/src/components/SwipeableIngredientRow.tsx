import React, { useRef } from 'react';
import { Alert, View, Text, TouchableOpacity } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

interface SwipeableIngredientRowProps {
  foodName: string;
  quantityLabel: string;
  caloriesLabel: string;
  showBottomBorder: boolean;
  isLastIngredient: boolean;
  disabled?: boolean;
  onConfirmDelete: () => void;
}

const DELETE_ACTION_WIDTH = 80;

const SwipeableIngredientRow: React.FC<SwipeableIngredientRowProps> = ({
  foodName,
  quantityLabel,
  caloriesLabel,
  showBottomBorder,
  isLastIngredient,
  disabled = false,
  onConfirmDelete,
}) => {
  const swipeableRef = useRef<React.ComponentRef<typeof ReanimatedSwipeable>>(null);

  const handleDeletePress = () => {
    const message = isLastIngredient
      ? 'This is the only ingredient. Removing it will delete the entire meal.'
      : undefined;
    Alert.alert(`Remove ${foodName}?`, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => swipeableRef.current?.close() },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          swipeableRef.current?.close();
          onConfirmDelete();
        },
      },
    ]);
  };

  const renderRightActions = () => (
    <TouchableOpacity
      className="bg-bg-danger justify-center items-center"
      style={{ width: DELETE_ACTION_WIDTH }}
      onPress={handleDeletePress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <Text className="text-text-danger font-semibold text-sm">Delete</Text>
    </TouchableOpacity>
  );

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      rightThreshold={40}
      enabled={!disabled}
    >
      <View
        className={`flex-row items-center px-3 py-2 bg-surface ${showBottomBorder ? 'border-b border-border-subtle' : ''}`}
      >
        <View className="flex-1 mr-2">
          <Text className="text-text-primary text-base" numberOfLines={1}>
            {foodName}
          </Text>
          <Text className="text-text-secondary text-xs mt-0.5">
            {quantityLabel}
          </Text>
        </View>
        <Text className="text-text-secondary text-sm font-medium">
          {caloriesLabel}
        </Text>
      </View>
    </ReanimatedSwipeable>
  );
};

export default SwipeableIngredientRow;
