import { RouteLoading } from '@/components/ui/RouteLoading';

export default function Loading() {
  return <RouteLoading label="Loading stock history" layout="archive" market="stocks" />;
}
