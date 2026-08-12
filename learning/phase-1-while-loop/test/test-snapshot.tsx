import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../caturn.tsx';

const { lastFrame, unmount } = render(React.createElement(App));
console.log('=== 初始界面 ===');
console.log(lastFrame());
unmount();