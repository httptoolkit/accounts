import * as React from 'react';

// All largely taken from the UI source - might be worth commonizing parts of this one day?

import {
    library,
    IconPrefix,
    IconName,
    IconDefinition,
    IconProp
} from '@fortawesome/fontawesome-svg-core';

import { faTrashAlt } from '@fortawesome/free-regular-svg-icons/faTrashAlt';
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons/faExclamationTriangle';
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { faUndo } from '@fortawesome/free-solid-svg-icons/faUndo';
import { faSave } from '@fortawesome/free-solid-svg-icons/faSave';
import { faCaretLeft } from '@fortawesome/free-solid-svg-icons/faCaretLeft';

const customSpinnerArc: IconDefinition = {
    // Based on https://codepen.io/aurer/pen/jEGbA
    prefix: <IconPrefix>'fac',
    iconName: <IconName>'spinner-arc',
    icon: [
        // height x width
        50, 50,
        [],
        '',
        // SVG path
        'M25.251,6.461c-10.318,0-18.683,8.365-18.683,18.683h4.068c0-8.071,6.543-14.615,14.615-14.615V6.461z'
    ]
};

library.add(
    customSpinnerArc,
    faTrashAlt,
    faExclamationTriangle,
    faPlus,
    faUndo,
    faSave,
    faCaretLeft
);

import { FontAwesomeIcon, Props as FAIProps } from '@fortawesome/react-fontawesome';

type ExtendedIconProp = IconProp | readonly ['fac', string] | readonly [IconPrefix, IconName];

export const Icon = React.memo(
    FontAwesomeIcon as (props: Omit<FAIProps, 'icon'> & {
        icon: ExtendedIconProp,
        onClick?: (event: React.MouseEvent) => void,
        onKeyPress?: (event: React.KeyboardEvent) => void
    }) => JSX.Element
);

import { styled } from './styles';

export const WarningIcon = styled(Icon).attrs(() => ({
    icon: ['fas', 'exclamation-triangle']
}))`
    margin: 0 6px;
    color: ${p => p.theme.warningColor};
`;