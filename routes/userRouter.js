import { Router } from 'express'
import userController from '../controllers/userController.js'
import authMiddleware from '../middleware/authMiddleware.js'
import chatController from '../controllers/chatController.js'
const router = Router()

router.post('/registration', userController.registration)
router.get('/search', authMiddleware, userController.searchUser)
router.post('/login', userController.login)
router.get('/auth', authMiddleware, userController.check)
router.put('/profile', authMiddleware, userController.updateProfile)
router.post('/getUsersInfo', authMiddleware, userController.getUserInformation)
export default router
