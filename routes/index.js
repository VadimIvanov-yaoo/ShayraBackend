import Router from 'express'
import userRouter from './userRouter.js'
import chatRouter from './chatRouter.js'
const router = new Router()

router.use('/user', userRouter)
router.use('/chat', chatRouter)

export default router
