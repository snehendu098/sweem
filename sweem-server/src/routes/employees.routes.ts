import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AuthEnv } from '../types'
import { authMiddleware } from '../middleware/auth.middleware'
import { createEmployee, listEmployees, updateEmployee, deleteEmployee, bulkCreateEmployees } from '../controllers/employees.controllers'
import { createEmployeeSchema, updateEmployeeSchema, bulkCreateEmployeesSchema } from '../schemas/employees.schema'

const employees = new Hono<AuthEnv>()

employees.post('/', authMiddleware, zValidator('json', createEmployeeSchema), createEmployee)
employees.post('/bulk', authMiddleware, zValidator('json', bulkCreateEmployeesSchema), bulkCreateEmployees)
employees.get('/', listEmployees)
employees.put('/:employee_id', authMiddleware, zValidator('json', updateEmployeeSchema), updateEmployee)
employees.delete('/:employee_id', authMiddleware, deleteEmployee)

export default employees
