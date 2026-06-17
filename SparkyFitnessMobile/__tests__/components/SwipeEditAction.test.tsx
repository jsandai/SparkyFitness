import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import SwipeEditAction from '../../src/components/SwipeEditAction';

describe('SwipeEditAction', () => {
  it('renders an Edit label and fires onPress when the action is pressed', () => {
    const onPress = jest.fn();
    const screen = render(<SwipeEditAction onPress={onPress} />);

    expect(screen.getByText('Edit')).toBeTruthy();
    fireEvent.press(screen.getByTestId('swipe-edit-action'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
