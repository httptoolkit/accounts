import * as React from 'react';

// All largely taken from the UI source - might be worth commonizing parts of this one day?

import {
    library,
    IconPrefix,
    IconName,
    IconProp
} from '@fortawesome/fontawesome-svg-core';

import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons/faExclamationTriangle';

library.add(
    faExclamationTriangle
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