import redisClient from '../services/redis';
import {parseJson} from './helpers';
import logger from './logger';
import dayjs from 'dayjs';

export interface BatchProgress {
  total: number;
  cursor: string | null;
  batch: number;
  started_at: string | null;
  status: string | null;
}

interface Constructor {
  redisKey: string;
  ttl: number;
}

export class BatchProgressTracker {
  private redisKey: string;
  private ttl: number;

  constructor({redisKey, ttl}: Constructor) {
    this.redisKey = redisKey;
    this.ttl = ttl; // Default 24 hours
  }

  async initialize(): Promise<void> {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }

      const now = dayjs().toISOString();
      const payload: BatchProgress = {
        started_at: now,
        status: 'running',
        total: 0,
        batch: 1,
        cursor: null,
      };

      await redisClient.setEx(this.redisKey, this.ttl, JSON.stringify(payload));
    } catch (error) {
      logger.error(
        error,
        `Error initializing batch progress for ${this.redisKey}`,
      );
      throw error;
    }
  }

  async updateProgress(
    cursor: string | null,
    processed: number,
    batchNumber: number,
  ): Promise<void> {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }

      const current = await this.getProgress();
      const updated: BatchProgress = {
        ...current,
        total: current.total + processed,
        batch: batchNumber,
        ...(cursor ? {cursor} : {}),
      };

      await redisClient.setEx(this.redisKey, this.ttl, JSON.stringify(updated));
    } catch (error) {
      logger.error(error, `Error updating batch progress for ${this.redisKey}`);
      throw error;
    }
  }

  /**
   * Get current batch processing progress
   */
  async getProgress(): Promise<BatchProgress> {
    const defaultResult: BatchProgress = {
      total: 0,
      cursor: null,
      batch: 0,
      started_at: null,
      status: null,
    };

    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }

      const payload = await redisClient.get(this.redisKey);
      if (!payload) return defaultResult;

      const parsed = parseJson(payload.toString());
      if (!parsed) return defaultResult;

      return {
        total: parseInt(parsed.total?.toString() || '0'),
        cursor: parsed.cursor || null,
        batch: parseInt(parsed.batch?.toString() || '0'),
        started_at: parsed.started_at || null,
        status: parsed.status || null,
      };
    } catch (error) {
      logger.error(error, `Error getting batch progress for ${this.redisKey}`);
      return defaultResult;
    }
  }

  async clear(): Promise<void> {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }

      await redisClient.del(this.redisKey);
    } catch (error) {
      logger.error(error, `Error clearing batch progress for ${this.redisKey}`);
      throw error;
    }
  }
  async markCompleted(): Promise<void> {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }

      const current = await this.getProgress();
      const updated: BatchProgress = {
        ...current,
        status: 'completed',
      };

      await redisClient.setEx(this.redisKey, this.ttl, JSON.stringify(updated));
    } catch (error) {
      logger.error(
        error,
        `Error marking batch as completed for ${this.redisKey}`,
      );
      throw error;
    }
  }

  async markFailed(): Promise<void> {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }

      const current = await this.getProgress();
      const updated: BatchProgress = {
        ...current,
        status: 'failed',
      };

      await redisClient.setEx(this.redisKey, this.ttl, JSON.stringify(updated));
    } catch (error) {
      logger.error(error, `Error marking batch as failed for ${this.redisKey}`);
      throw error;
    }
  }

  async isRunning(maxHours = 2): Promise<boolean> {
    const progress = await this.getProgress();

    if (progress.status !== 'running' || !progress.started_at) {
      return false;
    }

    const startedAt = dayjs(progress.started_at);
    const now = dayjs();

    // If run started more than maxHours ago, consider it stale
    return now.diff(startedAt, 'hours') < maxHours;
  }
}
