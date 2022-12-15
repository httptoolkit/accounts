import { SKU } from "../../module/src/types";

import { AppMetadata, TrialUserMetadata } from "./auth0";
import { getSkuForPaddleId } from "./paddle";

export const isProSubscription = (sku: string | undefined) =>
    sku?.startsWith('pro-');

export const isTeamSubscription = (sku: string | undefined) =>
    sku?.startsWith('team-');

export const getSku = (metadata: AppMetadata | undefined): SKU | undefined => {
    if (!metadata) return undefined;
    const subMetadata = metadata as TrialUserMetadata;
    return subMetadata.subscription_sku
        ?? getSkuForPaddleId(subMetadata.subscription_plan_id);
}