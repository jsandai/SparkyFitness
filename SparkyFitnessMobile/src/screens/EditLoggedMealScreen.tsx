import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useCSSVariable } from 'uniwind';
import Button from '../components/ui/Button';
import FormInput from '../components/FormInput';
import Icon from '../components/Icon';
import StepperInput from '../components/StepperInput';
import BottomSheetPicker from '../components/BottomSheetPicker';
import CalendarSheet, { type CalendarSheetRef } from '../components/CalendarSheet';
import NutritionMacroCard from '../components/NutritionMacroCard';
import SwipeableIngredientRow from '../components/SwipeableIngredientRow';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { useMealTypes, usePreferences } from '../hooks';
import { useFoodEntryMealDetails } from '../hooks/useFoodEntryMealDetails';
import { useUpdateFoodEntryMeal } from '../hooks/useUpdateFoodEntryMeal';
import { useDeleteFoodEntryMeal } from '../hooks/useDeleteFoodEntryMeal';
import { foodEntryMealDetailQueryKey } from '../hooks/queryKeys';
import { formatDateLabel, normalizeDate } from '../utils/dateUtils';
import { getMealTypeLabel } from '../constants/meals';
import { toMealFoodPayload } from '../utils/mealBuilderDraft';
import { DECIMAL_INPUT_REGEX, parseDecimalInput } from '../utils/numericInput';
import type { FoodEntryMeal, FoodEntryMealUpdateData } from '../types/foodEntryMeals';
import type { RootStackScreenProps } from '../types/navigation';

type EditLoggedMealScreenProps = RootStackScreenProps<'EditLoggedMeal'>;

const EditLoggedMealScreen: React.FC<EditLoggedMealScreenProps> = ({ navigation, route }) => {
  const { foodEntryMealId, initialMeal } = route.params;
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const calendarRef = useRef<CalendarSheetRef>(null);
  const queryClient = useQueryClient();

  const { meal, isLoading, isError, error } = useFoodEntryMealDetails(foodEntryMealId, { initialMeal });
  const { mealTypes } = useMealTypes();
  const { preferences } = usePreferences();
  const showNetCarbs = preferences?.show_net_carbs === true;

  const [name, setName] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedMealId, setSelectedMealId] = useState<string | undefined>(undefined);
  const [quantityText, setQuantityText] = useState<string | null>(null);
  // Snapshot of the meal taken right before an optimistic ingredient delete,
  // used to roll back the cache if the PUT or DELETE fails.
  const optimisticSnapshotRef = useRef<FoodEntryMeal | null>(null);

  const effectiveName = name ?? meal?.name ?? '';
  const effectiveDate = selectedDate ?? (meal ? normalizeDate(meal.entry_date) : null);
  const effectiveMealId = selectedMealId ?? meal?.meal_type_id ?? undefined;
  const effectiveQuantityText = quantityText ?? (meal ? String(meal.quantity) : '');
  const quantity = parseDecimalInput(effectiveQuantityText) || 0;
  const originalQuantity = meal?.quantity ?? 1;
  const scaleFactor = originalQuantity > 0 ? quantity / originalQuantity : 0;

  const selectedMealType = mealTypes.find((mt) => mt.id === effectiveMealId);
  const mealPickerOptions = useMemo(
    () => mealTypes.map((mt) => ({ label: getMealTypeLabel(mt.name), value: mt.id })),
    [mealTypes],
  );

  const initialDate = meal ? normalizeDate(meal.entry_date) : null;
  const dirty =
    meal != null &&
    (
      (name !== null && name !== meal.name) ||
      (selectedDate !== null && selectedDate !== initialDate) ||
      (selectedMealId !== undefined && selectedMealId !== meal.meal_type_id) ||
      (quantityText !== null && quantity !== meal.quantity)
    );

  const { updateMeal, isPending: isSavePending, invalidateCache: invalidateUpdateCache } = useUpdateFoodEntryMeal({
    mealId: foodEntryMealId,
    entryDate: meal?.entry_date ?? '',
    onSuccess: () => {
      invalidateUpdateCache(effectiveDate ?? undefined);
      navigation.goBack();
    },
  });

  const rollbackOptimisticDelete = () => {
    const snapshot = optimisticSnapshotRef.current;
    if (snapshot) {
      queryClient.setQueryData(foodEntryMealDetailQueryKey(foodEntryMealId), snapshot);
      optimisticSnapshotRef.current = null;
    }
  };

  const { confirmAndDelete, deleteEntry, isPending: isDeletePending, invalidateCache: invalidateDeleteCache } = useDeleteFoodEntryMeal({
    mealId: foodEntryMealId,
    entryDate: meal?.entry_date ?? '',
    onSuccess: () => {
      optimisticSnapshotRef.current = null;
      invalidateDeleteCache();
      navigation.goBack();
    },
    onError: rollbackOptimisticDelete,
  });

  const {
    updateMeal: removeIngredientUpdate,
    isPending: isIngredientUpdatePending,
    invalidateCache: invalidateIngredientUpdateCache,
  } = useUpdateFoodEntryMeal({
    mealId: foodEntryMealId,
    entryDate: meal?.entry_date ?? '',
    onSuccess: () => {
      // The optimistic cache update done in handleRemoveIngredient already
      // reflects the deletion. Invalidate sibling caches (daily summary,
      // recent meals) and let this query refetch in the background to pick
      // up the server's authoritative snapshot.
      optimisticSnapshotRef.current = null;
      invalidateIngredientUpdateCache();
    },
    onError: rollbackOptimisticDelete,
  });

  const isRowActionDisabled = isIngredientUpdatePending || isDeletePending || isSavePending;
  // Block swipe-delete while the form has unsaved edits to other meal fields:
  // the optimistic PUT uses server-side meal values for everything except foods,
  // so firing it while `dirty` would silently overwrite the user's pending
  // name / date / meal type / quantity changes.
  const isSwipeDisabled = isRowActionDisabled || dirty;

  const handleRemoveIngredient = async (index: number) => {
    if (!meal || isSwipeDisabled) return;

    const nextFoods = meal.foods.filter((_, idx) => idx !== index);

    optimisticSnapshotRef.current = meal;
    await queryClient.cancelQueries({ queryKey: foodEntryMealDetailQueryKey(foodEntryMealId) });
    queryClient.setQueryData<FoodEntryMeal>(
      foodEntryMealDetailQueryKey(foodEntryMealId),
      (cached) => (cached ? { ...cached, foods: nextFoods } : cached),
    );

    if (nextFoods.length === 0) {
      deleteEntry();
      return;
    }

    const payload: FoodEntryMealUpdateData = {
      name: meal.name,
      meal_type: meal.meal_type,
      meal_type_id: meal.meal_type_id ?? undefined,
      entry_date: normalizeDate(meal.entry_date),
      quantity: meal.quantity,
      unit: meal.unit,
      meal_template_id: meal.meal_template_id,
      foods: nextFoods.map(toMealFoodPayload),
    };
    removeIngredientUpdate(payload);
  };

  const [accentColor, textPrimary] = useCSSVariable([
    '--color-accent-primary',
    '--color-text-primary',
  ]) as [string, string];

  const updateQuantityText = (text: string) => {
    if (DECIMAL_INPUT_REGEX.test(text)) {
      setQuantityText(text);
    }
  };

  const clampQuantity = () => {
    if (quantity <= 0) {
      setQuantityText('1');
    }
  };

  const adjustQuantity = (delta: number) => {
    const step = 0.5;
    const next = quantity + delta * step;
    setQuantityText(String(Math.max(step, next)));
  };

  const canSave = dirty && quantity > 0 && !!meal && meal.foods.length > 0 && !!effectiveDate;

  const handleSave = () => {
    if (!meal || !canSave || !effectiveDate) return;

    const payload: FoodEntryMealUpdateData = {
      name: effectiveName,
      meal_type: selectedMealType?.name ?? meal.meal_type,
      meal_type_id: effectiveMealId,
      entry_date: effectiveDate,
      quantity,
      unit: meal.unit,
      meal_template_id: meal.meal_template_id,
      foods: meal.foods.map((f) => ({
        ...toMealFoodPayload(f),
        quantity: meal.meal_template_id ? f.quantity : f.quantity * scaleFactor,
      })),
    };

    updateMeal(payload);
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-background justify-center items-center" style={{ paddingTop: insets.top }}>
        <ActivityIndicator size="large" color={accentColor} />
      </View>
    );
  }

  if (isError || !meal) {
    throw error instanceof Error ? error : new Error('Failed to load meal');
  }

  const scaledCalories = (meal.calories ?? 0) * scaleFactor;
  const scaledProtein = (meal.protein ?? 0) * scaleFactor;
  const scaledCarbs = (meal.carbs ?? 0) * scaleFactor;
  const scaledFat = (meal.fat ?? 0) * scaleFactor;
  const scaledFiber =
    meal.dietary_fiber != null ? meal.dietary_fiber * scaleFactor : undefined;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border-subtle">
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          className="z-10"
        >
          <Icon name="chevron-back" size={22} color={accentColor} />
        </TouchableOpacity>
        <View style={{ marginLeft: 'auto', zIndex: 10 }}>
          <Button
            variant="ghost"
            onPress={handleSave}
            disabled={!canSave || isRowActionDisabled}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            textClassName="font-medium"
          >
            {isSavePending ? 'Saving...' : 'Save'}
          </Button>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 py-4 gap-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 + activeWorkoutBarPadding }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name */}
        <View>
          <Text className="text-text-secondary text-sm mb-1">Meal name</Text>
          <FormInput
            value={effectiveName}
            onChangeText={setName}
            placeholder="Meal name"
            autoCapitalize="sentences"
          />
        </View>

        {/* Aggregate nutrition */}
        <NutritionMacroCard
          calories={scaledCalories}
          protein={scaledProtein}
          carbs={scaledCarbs}
          fat={scaledFat}
          fiber={scaledFiber}
          showNetCarbs={showNetCarbs}
        />

        {/* Quantity */}
        <View>
          <Text className="text-text-secondary text-sm mb-1">Servings</Text>
          <View className="flex-row items-center">
            <StepperInput
              value={effectiveQuantityText}
              onChangeText={updateQuantityText}
              onBlur={clampQuantity}
              onIncrement={() => adjustQuantity(1)}
              onDecrement={() => adjustQuantity(-1)}
              keyboardType="decimal-pad"
            />
            <Text className="text-text-primary text-base font-medium ml-2">
              {meal.unit}
            </Text>
          </View>
        </View>

        {/* Date row */}
        <Animated.View layout={LinearTransition.duration(300)} className="flex-row items-center">
          <View className="flex-1 flex-row items-center">
            <Text className="text-text-secondary text-base mr-2">Date</Text>
            <TouchableOpacity
              onPress={() => calendarRef.current?.present()}
              activeOpacity={0.7}
              className="flex-row items-center"
            >
              <Text className="text-text-primary text-base font-medium">
                {effectiveDate ? formatDateLabel(effectiveDate) : ''}
              </Text>
              <Icon name="chevron-down" size={12} color={textPrimary} style={{ marginLeft: 6 }} weight="medium" />
            </TouchableOpacity>
          </View>

          {/* Meal type */}
          <View className="flex-1 flex-row items-center">
            <Text className="text-text-secondary text-base mr-2">Meal</Text>
            {selectedMealType && effectiveMealId ? (
              <BottomSheetPicker
                value={effectiveMealId}
                options={mealPickerOptions}
                onSelect={(id) => setSelectedMealId(id)}
                title="Select Meal"
                renderTrigger={({ onPress }) => (
                  <TouchableOpacity
                    onPress={onPress}
                    activeOpacity={0.7}
                    className="flex-row items-center"
                  >
                    <Text className="text-text-primary text-base font-medium">
                      {getMealTypeLabel(selectedMealType.name)}
                    </Text>
                    <Icon name="chevron-down" size={12} color={textPrimary} style={{ marginLeft: 6 }} weight="medium" />
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text className="text-text-primary text-base font-medium">
                {getMealTypeLabel(meal.meal_type)}
              </Text>
            )}
          </View>
        </Animated.View>

        {/* Component foods (swipe to delete) */}
        <View className="mt-2">
          <Text className="text-text-secondary text-sm mb-2">Foods in this meal</Text>
          <View className="bg-surface rounded-xl overflow-hidden">
            {meal.foods.map((food, index) => {
              const ratio = food.serving_size > 0 ? food.quantity / food.serving_size : food.quantity;
              const foodCals = Math.round((food.calories ?? 0) * ratio * scaleFactor);
              const scaledQty = food.quantity * scaleFactor;
              const displayQty = scaledQty % 1 === 0 ? scaledQty : parseFloat(scaledQty.toFixed(2));
              return (
                <SwipeableIngredientRow
                  key={`${food.food_id}-${index}`}
                  foodName={food.food_name}
                  quantityLabel={`${displayQty} ${food.unit}`}
                  caloriesLabel={`${foodCals} Cal`}
                  showBottomBorder={index < meal.foods.length - 1}
                  isLastIngredient={meal.foods.length === 1}
                  disabled={isSwipeDisabled}
                  onConfirmDelete={() => handleRemoveIngredient(index)}
                />
              );
            })}
          </View>
        </View>

        {/* Delete meal */}
        <Button
          variant="ghost"
          onPress={confirmAndDelete}
          disabled={isRowActionDisabled}
          className="mt-2"
          textClassName="text-bg-danger font-medium"
        >
          {isDeletePending ? 'Deleting...' : 'Delete Meal'}
        </Button>
      </ScrollView>

      <CalendarSheet
        ref={calendarRef}
        selectedDate={effectiveDate ?? ''}
        onSelectDate={(date) => setSelectedDate(date)}
      />
    </View>
  );
};

export default EditLoggedMealScreen;
