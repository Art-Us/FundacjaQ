import { describe, it, expect } from 'vitest';
import {
  RESOURCE_GROUP_LABELS,
  getResourceGroupInfo,
  HORIZON_LABELS,
  getHorizonInfo,
  NEED_URGENCY_LABELS,
  getNeedUrgencyInfo,
  ALLOCATION_STATUS_LABELS,
  getAllocationStatusInfo,
} from './resourceLabels';

describe('getResourceGroupInfo', () => {
  it('returns the matching badge info for a known group', () => {
    expect(getResourceGroupInfo('PEOPLE')).toEqual(RESOURCE_GROUP_LABELS.PEOPLE);
    expect(getResourceGroupInfo('WATER')).toEqual(RESOURCE_GROUP_LABELS.WATER);
    expect(getResourceGroupInfo('EQUIPMENT')).toEqual(RESOURCE_GROUP_LABELS.EQUIPMENT);
    expect(getResourceGroupInfo('OTHER')).toEqual(RESOURCE_GROUP_LABELS.OTHER);
  });

  it('falls back to OTHER for an unrecognized group value', () => {
    expect(getResourceGroupInfo('NOT_A_REAL_GROUP')).toEqual(RESOURCE_GROUP_LABELS.OTHER);
  });

  it('falls back to OTHER for an empty group value', () => {
    expect(getResourceGroupInfo('')).toEqual(RESOURCE_GROUP_LABELS.OTHER);
  });
});

describe('getHorizonInfo', () => {
  it('returns the matching badge info for a known horizon', () => {
    expect(getHorizonInfo('H24')).toEqual(HORIZON_LABELS.H24);
    expect(getHorizonInfo('H48')).toEqual(HORIZON_LABELS.H48);
    expect(getHorizonInfo('H72')).toEqual(HORIZON_LABELS.H72);
    expect(getHorizonInfo('WEEK')).toEqual(HORIZON_LABELS.WEEK);
  });

  it('falls back to H24 (the schema default) for an unrecognized horizon value', () => {
    expect(getHorizonInfo('NOT_A_REAL_HORIZON')).toEqual(HORIZON_LABELS.H24);
  });

  it('falls back to H24 for an empty horizon value', () => {
    expect(getHorizonInfo('')).toEqual(HORIZON_LABELS.H24);
  });
});

describe('getNeedUrgencyInfo', () => {
  it('returns the matching badge info for a known urgency', () => {
    expect(getNeedUrgencyInfo('NORMAL')).toEqual(NEED_URGENCY_LABELS.NORMAL);
    expect(getNeedUrgencyInfo('PILNE')).toEqual(NEED_URGENCY_LABELS.PILNE);
    expect(getNeedUrgencyInfo('KRYTYCZNY')).toEqual(NEED_URGENCY_LABELS.KRYTYCZNY);
  });

  it('falls back to NORMAL (the schema default) for an unrecognized urgency value', () => {
    expect(getNeedUrgencyInfo('NOT_A_REAL_URGENCY')).toEqual(NEED_URGENCY_LABELS.NORMAL);
  });

  it('falls back to NORMAL for an empty urgency value', () => {
    expect(getNeedUrgencyInfo('')).toEqual(NEED_URGENCY_LABELS.NORMAL);
  });
});

describe('getAllocationStatusInfo', () => {
  it('returns the matching badge info for every known status', () => {
    expect(getAllocationStatusInfo('DELIVERY_AGREED')).toEqual(ALLOCATION_STATUS_LABELS.DELIVERY_AGREED);
    expect(getAllocationStatusInfo('DELIVERED')).toEqual(ALLOCATION_STATUS_LABELS.DELIVERED);
    expect(getAllocationStatusInfo('RETURN_AGREED')).toEqual(ALLOCATION_STATUS_LABELS.RETURN_AGREED);
    expect(getAllocationStatusInfo('PARTIALLY_RETURNED')).toEqual(ALLOCATION_STATUS_LABELS.PARTIALLY_RETURNED);
    expect(getAllocationStatusInfo('RETURNED')).toEqual(ALLOCATION_STATUS_LABELS.RETURNED);
    expect(getAllocationStatusInfo('CANCELLED')).toEqual(ALLOCATION_STATUS_LABELS.CANCELLED);
  });

  it('falls back to DELIVERY_AGREED (the schema default) for an unrecognized status value', () => {
    expect(getAllocationStatusInfo('NOT_A_REAL_STATUS')).toEqual(ALLOCATION_STATUS_LABELS.DELIVERY_AGREED);
  });

  it('falls back to DELIVERY_AGREED for an empty status value', () => {
    expect(getAllocationStatusInfo('')).toEqual(ALLOCATION_STATUS_LABELS.DELIVERY_AGREED);
  });
});
