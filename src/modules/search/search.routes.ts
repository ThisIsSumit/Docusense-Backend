import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { apiLimiter } from '../../middleware/rate-limit.middleware';
import { searchController } from './search.controller';

const router = Router();

router.use(authenticate);
router.use(apiLimiter);

router.get('/', (req, res) => searchController.search(req, res));
router.post('/query', (req, res) => searchController.query(req, res));
router.get('/history', (req, res) => searchController.history(req, res));

export { router as searchRouter };
