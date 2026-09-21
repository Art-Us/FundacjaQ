import { describe, it, expect } from 'vitest';
import { ALERT_MESSAGE_TYPE_LABELS, getAlertMessageTypeInfo } from './alertMessageLabels';

describe('getAlertMessageTypeInfo', () => {
  it('returns the matching badge info for every known type', () => {
    expect(getAlertMessageTypeInfo('STAFF_COMMUNIQUE')).toEqual(ALERT_MESSAGE_TYPE_LABELS.STAFF_COMMUNIQUE);
    expect(getAlertMessageTypeInfo('SITUATION_UPDATE')).toEqual(ALERT_MESSAGE_TYPE_LABELS.SITUATION_UPDATE);
    expect(getAlertMessageTypeInfo('LOGISTICS_TRANSPORT')).toEqual(ALERT_MESSAGE_TYPE_LABELS.LOGISTICS_TRANSPORT);
    expect(getAlertMessageTypeInfo('UNIT_SUPPORT')).toEqual(ALERT_MESSAGE_TYPE_LABELS.UNIT_SUPPORT);
    expect(getAlertMessageTypeInfo('OTHER')).toEqual(ALERT_MESSAGE_TYPE_LABELS.OTHER);
  });

  it('falls back to OTHER for an unrecognized type value', () => {
    expect(getAlertMessageTypeInfo('NOT_A_REAL_TYPE')).toEqual(ALERT_MESSAGE_TYPE_LABELS.OTHER);
  });

  it('falls back to OTHER for an empty type value', () => {
    expect(getAlertMessageTypeInfo('')).toEqual(ALERT_MESSAGE_TYPE_LABELS.OTHER);
  });
});
