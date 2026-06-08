import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { createEmployee, listEmployees, updateRates, deleteEmployee } from '../controllers/employees.controllers'
import { createEmployeeSchema, updateRatesSchema } from '../schemas/employees.schema'

const employees = new Hono<AuthEnv>()

employees.post('/', authMiddleware, zValidator('json', createEmployeeSchema), createEmployee)
employees.get('/', listEmployees)
employees.put('/:employee_id/rates', authMiddleware, zValidator('json', updateRatesSchema), updateRates)
employees.delete('/:employee_id', authMiddleware, deleteEmployee)

export default employees
