import { describe, expect, it } from 'vitest';

import {
  camelCase,
  enumConstName,
  humanize,
  numberLiteral,
  pluralize,
  snakeCase,
  tableName,
  upperSnakeCase,
  words,
} from './naming';

describe('naming', () => {
  it('splits Pascal and camel case into words', () => {
    expect(words('ComplaintEventType')).toEqual(['Complaint', 'Event', 'Type']);
    expect(words('trackingNumber')).toEqual(['tracking', 'Number']);
  });

  it('pluralizes the English tail of a name', () => {
    expect(pluralize('Status')).toBe('Statuses');
    expect(pluralize('Priority')).toBe('Priorities');
    expect(pluralize('Channel')).toBe('Channels');
    expect(pluralize('Day')).toBe('Days');
  });

  it('derives the as-const list name of an enum', () => {
    expect(enumConstName('ComplaintStatus')).toBe('COMPLAINT_STATUSES');
    expect(enumConstName('SubmissionChannel')).toBe('SUBMISSION_CHANNELS');
    expect(enumConstName('ComplaintEventType')).toBe('COMPLAINT_EVENT_TYPES');
  });

  it('derives table names, snake_case columns and prose names', () => {
    expect(tableName('Complaint')).toBe('complaints');
    expect(tableName('ComplaintEvent')).toBe('complaint_events');
    expect(snakeCase('trackingNumber')).toBe('tracking_number');
    expect(snakeCase('category')).toBe('category');
    expect(humanize('ComplaintEvent')).toBe('complaint event');
  });

  it('handles kebab-case module names for tokens', () => {
    expect(upperSnakeCase('complaint')).toBe('COMPLAINT');
    expect(upperSnakeCase('wallet-transfer')).toBe('WALLET_TRANSFER');
    expect(camelCase('WalletTransfer')).toBe('walletTransfer');
  });

  it('prints numeric literals the way Prettier does', () => {
    expect(numberLiteral(254)).toBe('254');
    expect(numberLiteral(1000)).toBe('1_000');
    expect(numberLiteral(5000)).toBe('5_000');
    expect(numberLiteral(2000000)).toBe('2_000_000');
  });
});
