import { Badge } from "@/components/ui/badge";

interface RoleHeaderProps {
  user: any;
  title: string;
  stats?: Array<{ label: string; value: string }>;
  status?: { label: string; color: string };
}

export default function RoleHeader({ user, title, stats, status }: RoleHeaderProps) {
  return (
    <div className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-gray-300 rounded-full mr-4 flex items-center justify-center">
              {user?.profileImageUrl ? (
                <img 
                  src={user.profileImageUrl} 
                  alt="Profile" 
                  className="w-12 h-12 rounded-full object-cover"
                />
              ) : (
                <i className="fas fa-user text-gray-600"></i>
              )}
            </div>
            <div>
              <h2 className="text-xl font-semibold" data-testid="text-user-name">
                {user?.firstName && user?.lastName 
                  ? `${user.firstName} ${user.lastName}` 
                  : user?.email || "User"}
              </h2>
              <p className="text-gray-600" data-testid="text-user-role">{title}</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {stats && stats.map((stat, index) => (
              <div key={index} className="text-right">
                <div className="text-sm text-gray-600">{stat.label}</div>
                <div className="font-semibold" data-testid={`stat-${stat.label.replace(/\s+/g, '-').toLowerCase()}`}>
                  {stat.value}
                </div>
              </div>
            ))}
            {status && (
              <div className="flex items-center">
                <div className={`w-3 h-3 rounded-full animate-pulse mr-2 ${
                  status.color === 'success' ? 'bg-success' : 
                  status.color === 'warning' ? 'bg-warning' : 'bg-gray-500'
                }`}></div>
                <Badge variant={status.color === 'success' ? 'default' : 'secondary'}>
                  {status.label}
                </Badge>
              </div>
            )}
            <i className="fas fa-bell text-secondary text-xl"></i>
          </div>
        </div>
      </div>
    </div>
  );
}
