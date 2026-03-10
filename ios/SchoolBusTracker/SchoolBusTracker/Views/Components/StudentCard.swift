import SwiftUI

struct StudentCard: View {
    let student: Student
    let busData: ChildBusData?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Student header
            HStack {
                Image(systemName: "person.fill")
                    .foregroundColor(.white)
                    .padding(8)
                    .background(Color.blue)
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text(student.fullName)
                        .font(.headline)
                    if let grade = student.grade {
                        Text("Grade \(grade)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                if let bus = busData?.bus {
                    BusStatusBadge(status: bus.status ?? "idle")
                }
            }

            Divider()

            // Info rows
            HStack(spacing: 16) {
                if let school = student.school {
                    InfoChip(icon: "building.2", text: school.name, color: .purple)
                }
                if let route = student.route ?? busData?.route {
                    InfoChip(icon: "arrow.triangle.turn.up.right.diamond", text: route.name, color: .orange)
                }
            }

            if let bus = busData?.bus {
                HStack(spacing: 16) {
                    InfoChip(icon: "bus", text: "Bus #\(bus.busNumber)", color: .blue)
                    if let stop = busData?.stop ?? student.stop {
                        InfoChip(icon: "mappin", text: stop.name, color: .green)
                    }
                }
            }

            if let stop = student.stop, let time = stop.scheduledTime {
                let parts = time.split(separator: ":").compactMap { Int($0) }
                if parts.count >= 2 {
                    let h = parts[0]
                    let m = parts[1]
                    let period = h >= 12 ? "PM" : "AM"
                    let hour12 = h % 12 == 0 ? 12 : h % 12
                    HStack {
                        Image(systemName: "clock")
                            .foregroundColor(.blue)
                        Text("Pickup: \(hour12):\(String(format: "%02d", m)) \(period)")
                            .font(.subheadline)
                            .fontWeight(.medium)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
    }
}

struct BusStatusBadge: View {
    let status: String

    var body: some View {
        Text(displayStatus)
            .font(.caption2)
            .fontWeight(.semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(statusColor.opacity(0.15))
            .foregroundColor(statusColor)
            .cornerRadius(6)
    }

    private var displayStatus: String {
        switch status {
        case "on_route": return "On Route"
        case "idle": return "Idle"
        case "maintenance": return "Maintenance"
        case "emergency": return "Emergency"
        default: return status.capitalized
        }
    }

    private var statusColor: Color {
        switch status {
        case "on_route": return .green
        case "idle": return .gray
        case "maintenance": return .orange
        case "emergency": return .red
        default: return .secondary
        }
    }
}

struct InfoChip: View {
    let icon: String
    let text: String
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption2)
            Text(text)
                .font(.caption)
                .lineLimit(1)
        }
        .foregroundColor(color)
    }
}
