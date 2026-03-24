import { describe, expect, it } from 'vitest';
import { isEditableTarget, shouldIgnoreGlobalShortcut } from '@/utils/keyboardShortcuts';

describe('keyboardShortcuts', () => {
  it('detects editable form elements', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');

    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(select)).toBe(true);
  });

  it('detects contenteditable descendants', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    wrapper.appendChild(child);

    expect(isEditableTarget(child)).toBe(true);
  });

  it('ignores shortcuts when event already handled', () => {
    let ignored = false;
    const button = document.createElement('button');
    document.body.appendChild(button);

    button.addEventListener('keydown', (e) => {
      e.preventDefault();
      ignored = shouldIgnoreGlobalShortcut(e);
    });

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }));
    expect(ignored).toBe(true);
  });

  it('allows shortcuts for non-editable targets when not prevented', () => {
    let ignored = false;
    const div = document.createElement('div');
    document.body.appendChild(div);

    div.addEventListener('keydown', (e) => {
      ignored = shouldIgnoreGlobalShortcut(e);
    });

    div.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(ignored).toBe(false);
  });
});
