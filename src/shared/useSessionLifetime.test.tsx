import { StrictMode, useEffect } from 'react';
import { render } from '@testing-library/react';
import { useSessionLifetime } from './useSessionLifetime';

test('StrictMode cleanup permanently cancels earlier operations while the new setup stays live', () => {
  const operations: Array<() => boolean> = [];
  function Child() {
    const capture = useSessionLifetime();
    useEffect(() => { operations.push(capture()); }, [capture]);
    return null;
  }
  const view = render(<StrictMode><Child /></StrictMode>);
  expect(operations).toHaveLength(2);
  expect(operations[0]()).toBe(false);
  expect(operations[1]()).toBe(true);
  view.unmount();
  expect(operations.every(isAlive => !isAlive())).toBe(true);
});
