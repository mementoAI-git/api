import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import mongoose from 'mongoose';
import User from './user';
import Persona from './persona';
import Memory from './memory';

describe('Database Model Schema Validation', () => {
  it('User model should retain new preference fields (age_bracket, priority_dimensions, expression_mode)', () => {
    const user = new User({
      email: 'test@test.com',
      first_name: 'John',
      last_name: 'Doe',
      nickname: 'Johnny',
      gender: 'M',
      dob: new Date(),
      country: 'USA',
      password: 'password',
      private_key: 'key',
      public_key: 'key',
      providers: [],
      phone_number: '1234567890',
      picture: 'pic.jpg',
      preferences: {
        age_bracket: '30s',
        priority_dimensions: ['identity_self'],
        expression_mode: 'voice'
      }
    });

    assert.strictEqual(user.preferences.age_bracket, '30s');
    assert.strictEqual(user.preferences.expression_mode, 'voice');
    assert.deepStrictEqual(user.preferences.priority_dimensions, ['identity_self']);
    assert.strictEqual(user.preferences.communication_style, 'friendly');
  });

  it('Persona model should retain open_threads and motivation', () => {
    const persona = new Persona({
      user: new mongoose.Types.ObjectId().toString(),
      motivation: 'To reflect on life',
      open_threads: ['Thread 1', 'Thread 2']
    });

    assert.strictEqual(persona.motivation, 'To reflect on life');
    assert.deepStrictEqual(persona.open_threads, ['Thread 1', 'Thread 2']);
  });

  it('Memory model should retain dimensions', () => {
    const memory = new Memory({
      title: 'Test Conversation',
      body: 'Test body',
      user: new mongoose.Types.ObjectId().toString(),
      dimensions: ['career_work', 'identity_self']
    });

    assert.deepStrictEqual(memory.dimensions, ['career_work', 'identity_self']);
  });
});
