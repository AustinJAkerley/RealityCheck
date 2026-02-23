/**
 * Tests for the feedback reporter utility.
 */
import {
  submitFeedback,
  configureFeedbackEndpoint,
  getPendingFeedbackCount,
  clearPendingFeedback,
} from '../src/utils/feedback-reporter';
import { FeedbackReport } from '../src/types';

const sampleReport: FeedbackReport = {
  contentType: 'image',
  feedback: 'false_positive',
  url: 'https://example.com/photo.jpg',
  detectorScore: 0.72,
  timestamp: Date.now(),
};

describe('feedback reporter', () => {
  beforeEach(() => {
    configureFeedbackEndpoint(null); // reset endpoint
    clearPendingFeedback();
  });

  test('submitFeedback queues report when no endpoint is configured', () => {
    submitFeedback(sampleReport);
    expect(getPendingFeedbackCount()).toBe(1);
  });

  test('multiple submissions accumulate in queue', () => {
    submitFeedback(sampleReport);
    submitFeedback({ ...sampleReport, feedback: 'missed_ai' });
    expect(getPendingFeedbackCount()).toBe(2);
  });

  test('clearPendingFeedback empties the queue', () => {
    submitFeedback(sampleReport);
    clearPendingFeedback();
    expect(getPendingFeedbackCount()).toBe(0);
  });

  test('configureFeedbackEndpoint with null clears the endpoint', () => {
    configureFeedbackEndpoint(null);
    // After clearing, new submissions should be queued
    submitFeedback(sampleReport);
    expect(getPendingFeedbackCount()).toBe(1);
  });

  test('getPendingFeedbackCount returns 0 initially', () => {
    expect(getPendingFeedbackCount()).toBe(0);
  });
});
