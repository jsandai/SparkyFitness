// hooks/useFoodDatabaseManager.ts
import { useState } from 'react';
import { formatDateToYYYYMMDD } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { useAuth } from '@/hooks/useAuth';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from '@/hooks/use-toast';
import { info } from '@/utils/logging';
import type { Food, FoodVariant, FoodDeletionImpact } from '@/types/food';
import { MealFilter } from '@/types/meal';
import type { Meal } from '@/types/meal';
import {
  foodDeletionImpactOptions,
  useCreateFoodMutation,
  useDeleteFoodMutation,
  useFoods,
  useToggleFoodPublicMutation,
} from '@/hooks/Foods/useFoods';
import { foodVariantsOptions } from '@/hooks/Foods/useFoodVariants';
import { useQueryClient } from '@tanstack/react-query';

export function useFoodDatabaseManager() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { activeUserId } = useActiveUser();
  const { nutrientDisplayPreferences, loggingLevel } = usePreferences();
  const isMobile = useIsMobile();
  const platform = isMobile ? 'mobile' : 'desktop';
  const queryClient = useQueryClient();

  const quickInfoPreferences =
    nutrientDisplayPreferences.find(
      (p) => p.view_group === 'quick_info' && p.platform === platform
    ) ||
    nutrientDisplayPreferences.find(
      (p) => p.view_group === 'quick_info' && p.platform === 'desktop'
    );

  const visibleNutrients = quickInfoPreferences
    ? quickInfoPreferences.visible_nutrients
    : ['calories', 'protein', 'carbs', 'fat', 'dietary_fiber'];

  const [searchTerm, setSearchTerm] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(isMobile ? 5 : 10);
  const [currentPage, setCurrentPage] = useState(1);
  const [foodFilter, setFoodFilter] = useState<MealFilter>('all');
  const [sortOrder, setSortOrder] = useState<string>('name:asc');

  const [showFoodSearchDialog, setShowFoodSearchDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingFood, setEditingFood] = useState<Food | null>(null);
  const [showFoodUnitSelectorDialog, setShowFoodUnitSelectorDialog] =
    useState(false);
  const [foodToAddToMeal, setFoodToAddToMeal] = useState<Food | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [duplicatingFood, setDuplicatingFood] = useState<Food | null>(null);

  const [pendingDeletion, setPendingDeletion] = useState<{
    food: Food;
    impact: FoodDeletionImpact;
  } | null>(null);

  const { data: foodData, isLoading: loading } = useFoods(
    searchTerm,
    foodFilter,
    currentPage,
    itemsPerPage,
    sortOrder
  );
  const { mutate: togglePublicSharing } = useToggleFoodPublicMutation();
  const { mutateAsync: deleteFood } = useDeleteFoodMutation();
  const { mutateAsync: createFoodEntry } = useCreateFoodMutation();

  const totalPages = foodData
    ? Math.ceil(foodData.totalCount / itemsPerPage)
    : 0;

  const canEdit = (food: Food) => food.user_id === user?.id;

  const handlePageChange = (page: number, pageSize?: number) => {
    if (pageSize !== undefined && pageSize !== itemsPerPage) {
      setItemsPerPage(pageSize);
      setCurrentPage(1);
    } else {
      setCurrentPage(page);
    }
  };

  const handleEdit = (food: Food) => {
    setEditingFood(food);
    setShowEditDialog(true);
  };

  const handleSaveComplete = () => {
    setShowEditDialog(false);
    setEditingFood(null);
  };

  const handleDuplicate = async (food: Food) => {
    try {
      // The create flow reads variants inline from food.variants. An id-less
      // food never triggers the server-side variant fetch, so pre-fetch them
      // here and attach them to the copy before opening the form.
      const variants = await queryClient.fetchQuery(
        foodVariantsOptions(food.id)
      );
      // Clearing the food id routes the save through the create path, which
      // rebuilds the food and every variant from scratch and assigns fresh ids,
      // so the original food is left untouched. Stripping the source ids and
      // setting the current user as owner keeps that intent explicit (the copy
      // is a new private food owned by whoever duplicates it) and guards against
      // future save-path changes.
      const newVariants = (variants ?? []).map(({ id, ...variant }) => variant);
      let newDefaultVariant: FoodVariant | undefined;
      if (food.default_variant) {
        const { id, ...rest } = food.default_variant;
        newDefaultVariant = rest;
      }
      setDuplicatingFood({
        ...food,
        id: '',
        user_id: user?.id,
        name: `${food.name} ${t('foodDatabaseManager.copySuffix', '(copy)')}`,
        shared_with_public: false,
        variants: newVariants,
        default_variant: newDefaultVariant,
      });
      setShowDuplicateDialog(true);
    } catch (err) {
      toast({
        title: t('common.error', 'Error'),
        description: t(
          'foodDatabaseManager.duplicateFailed',
          'Failed to duplicate food.'
        ),
        variant: 'destructive',
      });
    }
  };

  const handleDuplicateComplete = () => {
    setShowDuplicateDialog(false);
    setDuplicatingFood(null);
  };

  const handleFoodSelected = (item: Food | Meal, type: 'food' | 'meal') => {
    setShowFoodSearchDialog(false);
    if (type === 'food') {
      setFoodToAddToMeal(item as Food);
      setShowFoodUnitSelectorDialog(true);
    }
  };

  const handleAddFoodToMeal = async (
    food: Food,
    quantity: number,
    unit: string,
    selectedVariant: FoodVariant
  ) => {
    if (!user || !activeUserId) {
      toast({
        title: t('common.error', 'Error'),
        description: t(
          'foodDatabaseManager.userNotAuthenticated',
          'User not authenticated.'
        ),
        variant: 'destructive',
      });
      return;
    }

    await createFoodEntry({
      foodData: {
        food_id: food.id!,
        meal_type: 'breakfast',
        quantity,
        unit,
        entry_date: formatDateToYYYYMMDD(new Date()),
        variant_id: selectedVariant.id || null,
      },
    });

    setShowFoodUnitSelectorDialog(false);
    setFoodToAddToMeal(null);
  };

  const handleDeleteRequest = async (food: Food) => {
    if (!user || !activeUserId) return;
    const impact = await queryClient.fetchQuery(
      foodDeletionImpactOptions(food.id)
    );
    setPendingDeletion({ food, impact });
  };

  const handleConfirmDelete = async (force: boolean = false) => {
    if (!pendingDeletion || !activeUserId) return;
    info(loggingLevel, `confirmDelete called with force: ${force}`);
    await deleteFood({ foodId: pendingDeletion.food.id, force });
    setPendingDeletion(null);
  };

  const handleCancelDelete = () => setPendingDeletion(null);

  return {
    user,
    isAuthenticated: !!user && !!activeUserId,
    isMobile,
    visibleNutrients,
    searchTerm,
    setSearchTerm,
    itemsPerPage,
    setItemsPerPage,
    currentPage,
    setCurrentPage,
    foodFilter,
    setFoodFilter,
    sortOrder,
    setSortOrder,
    foodData,
    loading,
    totalPages,
    showFoodSearchDialog,
    setShowFoodSearchDialog,
    showEditDialog,
    setShowEditDialog,
    editingFood,
    showFoodUnitSelectorDialog,
    setShowFoodUnitSelectorDialog,
    foodToAddToMeal,
    pendingDeletion,
    showDuplicateDialog,
    setShowDuplicateDialog,
    duplicatingFood,
    togglePublicSharing,
    canEdit,
    handlePageChange,
    handleEdit,
    handleDuplicate,
    handleDuplicateComplete,
    handleSaveComplete,
    handleFoodSelected,
    handleAddFoodToMeal,
    handleDeleteRequest,
    handleConfirmDelete,
    handleCancelDelete,
    deleteFood,
  };
}
