import { screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import WaterIntake from '@/pages/Diary/WaterIntake';
import { useWaterContainer } from '@/contexts/WaterContainerContext';
import {
  useWaterIntakeQuery,
  useUpdateWaterIntakeMutation,
  useWaterIntakeLogQuery,
  useUpdateWaterIntakeLogTimeMutation,
} from '@/hooks/Diary/useWaterIntake';
import { renderWithClient } from '../test-utils';

// Mock hooks and contexts
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (
        key === 'foodDiary.waterIntake.perDrink' ||
        key === 'foodDiary.waterIntake.defaultPerDrink'
      ) {
        return `${options?.['volume']} ${options?.['unit']}`;
      }
      if (key === 'foodDiary.waterIntake.title') {
        return 'Water Intake';
      }
      return key;
    },
    i18n: {
      language: 'en',
      changeLanguage: jest.fn(),
    },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: jest.fn(),
  },
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ water_display_unit: 'ml', timezone: 'UTC' }),
}));

jest.mock('@workspace/shared', () => ({
  instantHourMinute: () => ({ hour: 12, minute: 0 }),
  dayToUtcRange: () => ({
    start: new Date('2023-10-27T00:00:00Z'),
    end: new Date('2023-10-28T00:00:00Z'),
  }),
}));

jest.mock('@/contexts/ActiveUserContext', () => ({
  useActiveUser: () => ({ activeUserId: 'user-1' }),
}));

jest.mock('@/contexts/WaterContainerContext', () => ({
  useWaterContainer: jest.fn(),
}));

jest.mock('@/hooks/Diary/useWaterIntake', () => ({
  useWaterGoalQuery: jest.fn().mockReturnValue({ data: 2000 }),
  useWaterIntakeQuery: jest.fn().mockReturnValue({ data: 500 }),
  useUpdateWaterIntakeMutation: jest.fn(),
  useWaterIntakeLogQuery: jest.fn().mockReturnValue({ data: [] }),
  useDeleteWaterIntakeLogMutation: jest.fn().mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  }),
  useUpdateWaterIntakeLogTimeMutation: jest.fn().mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

// Mock icons
jest.mock('lucide-react', () => ({
  Droplet: () => <div data-testid="droplet-icon" />,
  ChevronLeft: () => <div data-testid="chevron-left" />,
  ChevronRight: () => <div data-testid="chevron-right" />,
  ChevronDown: () => <div data-testid="chevron-down" />,
  ChevronUp: () => <div data-testid="chevron-up" />,
  Star: () => <div data-testid="star-icon" />,
  Plus: () => <div data-testid="plus-icon" />,
  Minus: () => <div data-testid="minus-icon" />,
  Trash2: () => <div data-testid="trash-icon" />,
  Clock: () => <div data-testid="clock-icon" />,
}));

const mockContainers = [
  {
    id: 1,
    name: 'Work Bottle',
    volume: 500,
    unit: 'ml',
    servings_per_container: 1,
    is_primary: true,
  },
  {
    id: 2,
    name: 'Home Glass',
    volume: 250,
    unit: 'ml',
    servings_per_container: 1,
    is_primary: false,
  },
];

describe('WaterIntake Component', () => {
  const mockMutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useWaterIntakeQuery as jest.Mock).mockReturnValue({ data: 500 });
    (useWaterContainer as jest.Mock).mockReturnValue({
      activeContainer: mockContainers[0],
      containers: mockContainers,
    });
    (useUpdateWaterIntakeMutation as jest.Mock).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    });
  });

  it('renders the initial active container and its volume in the intuitive control row', () => {
    renderWithClient(<WaterIntake selectedDate="2023-10-27" />);

    expect(screen.getByText(/WORK BOTTLE/i)).toBeInTheDocument();
    // The volume should be between the plus/minus buttons
    expect(screen.getByText('500 ml')).toBeInTheDocument();
    // Primary container should have a star
    expect(screen.getByTestId('star-icon')).toBeInTheDocument();
  });

  it('cycles to the next container and updates the volume display', () => {
    renderWithClient(<WaterIntake selectedDate="2023-10-27" />);

    const nextButton = screen.getByTestId('chevron-right').parentElement;
    fireEvent.click(nextButton!);

    expect(screen.getByText(/HOME GLASS/i)).toBeInTheDocument();
    expect(screen.getByText('250 ml')).toBeInTheDocument();
    // Non-primary container should NOT have a star
    expect(screen.queryByTestId('star-icon')).not.toBeInTheDocument();
  });

  it('calls update mutation with the toggled container ID when clicking the Plus icon button', () => {
    renderWithClient(<WaterIntake selectedDate="2023-10-27" />);

    const nextButton = screen.getByTestId('chevron-right').parentElement;
    fireEvent.click(nextButton!); // Switch to Home Glass (ID: 2, 250ml)

    const plusButton = screen.getByTestId('plus-icon').parentElement;
    fireEvent.click(plusButton!);

    expect(mockMutate).toHaveBeenCalledWith({
      user_id: 'user-1',
      entry_date: '2023-10-27',
      change_drinks: 1,
      container_id: 2, // Home Glass
    });
  });

  describe('drink-log time editing', () => {
    const mockLogEntry = {
      id: 'log-1',
      entry_date: '2023-10-27T00:00:00.000Z',
      logged_at: '2023-10-27T12:00:00.000Z',
      created_at: '2023-10-27T12:00:00.000Z',
      water_ml: 500,
      container_name: 'Work Bottle',
    };
    const mockUpdateLogTime = jest.fn();

    beforeEach(() => {
      (useWaterIntakeLogQuery as jest.Mock).mockReturnValue({
        data: [mockLogEntry],
      });
      (useUpdateWaterIntakeLogTimeMutation as jest.Mock).mockReturnValue({
        mutate: mockUpdateLogTime,
        isPending: false,
      });
    });

    const openTimeEditor = () => {
      // "Today's drinks" log is collapsed by default; expand it, then click
      // the time button (rendered as the mocked instantHourMinute -> "12:00").
      // The mocked t() returns raw i18n keys, so match on the logTitle key.
      fireEvent.click(screen.getByText(/logTitle/i));
      fireEvent.click(screen.getByText('12:00'));
      return screen.getByPlaceholderText('HH:MM') as HTMLInputElement;
    };

    it('accepts bare 24-hour digits ("2210") and commits the parsed instant', () => {
      renderWithClient(<WaterIntake selectedDate="2023-10-27" />);
      const input = openTimeEditor();

      fireEvent.change(input, { target: { value: '2210' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockUpdateLogTime).toHaveBeenCalledWith({
        logId: 'log-1',
        // dayToUtcRange mock start (2023-10-27T00:00Z) + 22h10m
        loggedAt: '2023-10-27T22:10:00.000Z',
      });
    });

    it('accepts colon-separated 24-hour time ("22:10")', () => {
      renderWithClient(<WaterIntake selectedDate="2023-10-27" />);
      const input = openTimeEditor();

      fireEvent.change(input, { target: { value: '22:10' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockUpdateLogTime).toHaveBeenCalledWith({
        logId: 'log-1',
        loggedAt: '2023-10-27T22:10:00.000Z',
      });
    });

    it('rejects an out-of-range time without committing', () => {
      renderWithClient(<WaterIntake selectedDate="2023-10-27" />);
      const input = openTimeEditor();

      fireEvent.change(input, { target: { value: '9999' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockUpdateLogTime).not.toHaveBeenCalled();
    });

    it('parses a 12-hour PM time ("230pm") to 24-hour', () => {
      renderWithClient(<WaterIntake selectedDate="2023-10-27" />);
      const input = openTimeEditor();

      fireEvent.change(input, { target: { value: '230pm' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockUpdateLogTime).toHaveBeenCalledWith({
        logId: 'log-1',
        loggedAt: '2023-10-27T14:30:00.000Z', // 2:30 PM
      });
    });

    it('parses "12:15am" as after-midnight (00:15)', () => {
      renderWithClient(<WaterIntake selectedDate="2023-10-27" />);
      const input = openTimeEditor();

      fireEvent.change(input, { target: { value: '12:15am' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockUpdateLogTime).toHaveBeenCalledWith({
        logId: 'log-1',
        loggedAt: '2023-10-27T00:15:00.000Z',
      });
    });

    it('rejects an invalid 12-hour hour ("13pm")', () => {
      renderWithClient(<WaterIntake selectedDate="2023-10-27" />);
      const input = openTimeEditor();

      fireEvent.change(input, { target: { value: '13pm' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockUpdateLogTime).not.toHaveBeenCalled();
    });

    it('commits the native picker value (24-hour HH:MM) on change', () => {
      renderWithClient(<WaterIntake selectedDate="2023-10-27" />);
      openTimeEditor();

      // The clock button reveals a hidden native <input type="time">; selecting
      // a value fires onChange with a 24-hour "HH:MM" string.
      const picker = document.querySelector(
        'input[type="time"]'
      ) as HTMLInputElement;
      fireEvent.change(picker, { target: { value: '18:45' } });

      expect(mockUpdateLogTime).toHaveBeenCalledWith({
        logId: 'log-1',
        loggedAt: '2023-10-27T18:45:00.000Z',
      });
    });
  });

  it('disables the minus button when intake is 0', () => {
    // Override the mock to simulate zero water intake for this test
    (useWaterIntakeQuery as jest.Mock).mockReturnValue({ data: 0 });

    renderWithClient(<WaterIntake selectedDate="2023-10-27" />);

    const minusButton = screen.getByTestId('minus-icon').parentElement;
    expect(minusButton).toBeDisabled();
  });
});
