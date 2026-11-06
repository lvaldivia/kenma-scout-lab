import { seedData } from './seed.mjs';

export class MemoryStore {
  constructor() { this.reset(); }
  reset() { const data = seedData(); this.users = new Map(data.users.map(u => [u.id, u])); this.reports = new Map(data.reports.map(r => [r.id, r])); }
  async getUser(id) { return structuredClone(this.users.get(id)); }
  async putUser(user) { this.users.set(user.id, structuredClone(user)); }
  async listReports() { return structuredClone([...this.reports.values()]); }
  async getReport(id) { return structuredClone(this.reports.get(id)); }
  async deleteReport(id) { this.reports.delete(id); }
}

// Las mismas operaciones de dominio se usan en memoria y en DynamoDB.
export class DynamoStore {
  constructor(client, commands, table) { Object.assign(this, { client, commands, table }); }
  async get(pk) { const result = await this.client.send(new this.commands.GetCommand({ TableName: this.table, Key: { pk }, ConsistentRead: true })); return result.Item?.data; }
  async put(pk, data) { await this.client.send(new this.commands.PutCommand({ TableName: this.table, Item: { pk, kind: pk.split('#')[0], data } })); }
  getUser(id) { return this.get(`USER#${id}`); }
  putUser(user) { return this.put(`USER#${user.id}`, user); }
  getReport(id) { return this.get(`REPORT#${id}`); }
  async listReports() {
    const items = []; let start;
    do {
      const result = await this.client.send(new this.commands.ScanCommand({ TableName: this.table, FilterExpression: 'kind = :kind', ExpressionAttributeValues: { ':kind': 'REPORT' }, ExclusiveStartKey: start, ConsistentRead: true }));
      items.push(...(result.Items ?? []).map(item => item.data)); start = result.LastEvaluatedKey;
    } while (start);
    return items.sort((a,b) => a.id.localeCompare(b.id));
  }
  async deleteReport(id) { await this.client.send(new this.commands.DeleteCommand({ TableName: this.table, Key: { pk: `REPORT#${id}` } })); }
}
