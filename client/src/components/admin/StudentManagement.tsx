import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface StudentManagementProps {
  students: any[];
}

export default function StudentManagement({ students }: StudentManagementProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  const handleAction = (action: string, studentId?: string) => {
    toast({
      title: "Feature Coming Soon",
      description: `${action} functionality will be available in a future update.`,
    });
  };

  const filteredStudents = students.filter(student =>
    `${student.firstName} ${student.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.grade?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Student Management</CardTitle>
          <Button 
            size="sm"
            onClick={() => handleAction("Add Student")}
            data-testid="button-add-student-mgmt"
          >
            <i className="fas fa-plus mr-1"></i>Add Student
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <Input
            placeholder="Search students..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-search-students"
          />
        </div>

        <div className="space-y-3 max-h-64 overflow-y-auto">
          {filteredStudents && filteredStudents.length > 0 ? (
            filteredStudents.map((student) => (
              <div 
                key={student.id}
                className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                data-testid={`student-mgmt-${student.id}`}
              >
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-gray-300 rounded-full mr-3"></div>
                  <div>
                    <div className="font-medium" data-testid={`student-mgmt-name-${student.id}`}>
                      {student.firstName} {student.lastName}
                    </div>
                    <div className="text-sm text-gray-600" data-testid={`student-mgmt-details-${student.id}`}>
                      {student.grade && `${student.grade} • `}
                      {student.route?.name || 'No route assigned'}
                    </div>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button 
                    size="sm"
                    variant="ghost"
                    onClick={() => handleAction("Edit Student", student.id)}
                    data-testid={`button-edit-student-${student.id}`}
                  >
                    <i className="fas fa-edit text-primary"></i>
                  </Button>
                  <Button 
                    size="sm"
                    variant="ghost"
                    onClick={() => handleAction("Remove Student", student.id)}
                    data-testid={`button-remove-student-${student.id}`}
                  >
                    <i className="fas fa-user-minus text-destructive"></i>
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-gray-500 py-8">
              {searchTerm ? "No students found matching your search." : "No students found."}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
