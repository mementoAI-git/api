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

  it('User model should store passkeys with required fields', () => {
    const user = new User({
      email: 'passkey@test.com',
      first_name: 'Jane',
      last_name: 'Doe',
      nickname: 'Janey',
      gender: 'F',
      dob: new Date(),
      country: 'UK',
      password: 'secret',
      private_key: 'priv',
      public_key: 'pub',
      providers: [],
      phone_number: '0000000000',
      picture: 'pic.jpg',
      passkeys: [
        {
          credential_id: 'base64url-cred-id',
          public_key: 'base64-pub-key',
          counter: 0,
          device_name: 'MacBook Pro',
        },
      ],
    });

    assert.strictEqual(user.passkeys?.length, 1);
    assert.strictEqual(user.passkeys?.[0].credential_id, 'base64url-cred-id');
    assert.strictEqual(user.passkeys?.[0].public_key, 'base64-pub-key');
    assert.strictEqual(user.passkeys?.[0].counter, 0);
    assert.strictEqual(user.passkeys?.[0].device_name, 'MacBook Pro');
  });

  it('User passkey counter defaults to 0 when not provided', () => {
    const user = new User({
      email: 'passkey2@test.com',
      first_name: 'John',
      last_name: 'Smith',
      nickname: 'Johnny',
      gender: 'M',
      dob: new Date(),
      country: 'US',
      password: 'secret',
      private_key: 'priv',
      public_key: 'pub',
      providers: [],
      phone_number: '1111111111',
      picture: 'pic.jpg',
      passkeys: [
        {
          credential_id: 'cred-2',
          public_key: 'pub-key-2',
          device_name: 'iPhone',
        },
      ],
    });

    assert.strictEqual(user.passkeys?.[0].counter, 0);
  });

  it('User passkey device_name defaults to "Unknown device" when not provided', () => {
    const user = new User({
      email: 'passkey3@test.com',
      first_name: 'Alex',
      last_name: 'Jones',
      nickname: 'AJ',
      gender: 'other',
      dob: new Date(),
      country: 'CA',
      password: 'secret',
      private_key: 'priv',
      public_key: 'pub',
      providers: [],
      phone_number: '2222222222',
      picture: 'pic.jpg',
      passkeys: [
        {
          credential_id: 'cred-3',
          public_key: 'pub-key-3',
        },
      ],
    });

    assert.strictEqual(user.passkeys?.[0].device_name, 'Unknown device');
  });

  it('User model accepts empty passkeys array', () => {
    const user = new User({
      email: 'nopk@test.com',
      first_name: 'No',
      last_name: 'Passkey',
      nickname: 'NoPK',
      gender: 'M',
      dob: new Date(),
      country: 'AU',
      password: 'secret',
      private_key: 'priv',
      public_key: 'pub',
      providers: [],
      phone_number: '3333333333',
      picture: 'pic.jpg',
    });

    assert.deepStrictEqual(user.passkeys, []);
  });
});
